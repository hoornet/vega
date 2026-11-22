import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistantStore } from "../../stores/assistant";
import { activeProvider, isAssistantInvocation, normalizeAddress } from "../../lib/assistant/settings";
import { askAssistant } from "../../lib/assistant/client";
import { buildPack, askMessages, splitInvocation, wantsMyTone, LIMITS, SYSTEM_PROMPT, type PackNote, type PackSource } from "../../lib/assistant/context";
import { useMuteStore } from "../../stores/mute";
import { peekCachedProfile } from "../../hooks/useProfile";
import { nameOf } from "../../lib/utils";
import { currentAccount } from "../../lib/currentAccount";
import { fetchUserNotes } from "../../lib/nostr";
import { toPackNote, type SourceGetter } from "./source";
import type { ActiveProvider, AskHandle } from "../../types/assistant";

/**
 * The `@vega` mode of a box (CLAUDE.md, "The assistant"): whether the text asks Vega, the line
 * that says what would be sent where, the answer as it streams, and the question before anything
 * goes to a model in the cloud. One answer at a time, gone when the box is emptied.
 */

export type AnswerStatus = "idle" | "waiting" | "streaming" | "done" | "stopped" | "error";

export interface AnswerState {
  status: AnswerStatus;
  text: string;
  error: string | null;
  /** The failure is fixed in Settings → Assistant (no key, no model). */
  needsSettings: boolean;
  /** The model that answered, for the card. */
  model: string;
}

export interface ConsentRequest {
  /** Who the notes go to: "Anthropic", or the server's host. */
  who: string;
  /** What is sent: "This thread, 14 notes". */
  what: string;
  answer: (send: boolean, always: boolean) => void;
}

const IDLE: AnswerState = { status: "idle", text: "", error: null, needsSettings: false, model: "" };

/** Providers the user agreed to in this session, by address: asked once each. */
const agreedThisSession = new Set<string>();

/** Asks again about every provider: Settings' "Ask again", and the switch turned back on. */
export function forgetSessionConsent(): void {
  agreedThisSession.clear();
}

/** Whether a provider was agreed to in this session. */
export function agreedThisSessionTo(address: string): boolean {
  return agreedThisSession.has(address);
}

/** Who a provider sends to, in the user's words. */
export function providerName(provider: ActiveProvider): string {
  if (provider.preset === "claude") return "Anthropic";
  try {
    return new URL(provider.baseUrl).hostname || provider.label;
  } catch {
    return provider.label;
  }
}

function hiddenNow(): (pubkey: string, content: string) => boolean {
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore.getState();
  return (pubkey, content) => mutedPubkeys.includes(pubkey) || contentMatchesMutedKeyword(content);
}

function pubkeysOf(source: PackSource): string[] {
  switch (source.kind) {
    case "thread":
    case "feed":
      return [...source.notes.map((n) => n.pubkey), ...(source.kind === "thread" && source.replyTo ? [source.replyTo.pubkey] : [])];
    case "profile":
      return [source.pubkey];
    case "article":
      return [source.pubkey];
    case "note":
      return [source.note.pubkey];
  }
}

interface Options {
  text: string;
  source: SourceGetter | null;
  /** Puts an answer in the box, in place of its text. */
  onUse: (draft: string) => void;
}

export function useAssistantBox({ text, source, onUse }: Options) {
  const settings = useAssistantStore((s) => s.settings);
  const active = settings.enabled && isAssistantInvocation(text);
  const [answer, setAnswer] = useState<AnswerState>(IDLE);
  const [consent, setConsent] = useState<ConsentRequest | null>(null);
  // The same request, for a Discard to answer "no" to: a side effect has no place in a state updater.
  const pendingConsent = useRef<ConsentRequest | null>(null);
  const handle = useRef<AskHandle | null>(null);
  // Each question is numbered: pieces of an answer asked before a Discard or a new question are dropped.
  const turn = useRef(0);

  const provider = activeProvider(settings);
  const maxChars = provider.local ? LIMITS.localChars : LIMITS.cloudChars;

  /** The line under the box: what would be sent, and where. */
  let line: string | null = null;
  if (active) {
    const here = source?.();
    const { question, draft } = splitInvocation(text);
    let what: string;
    if (here) {
      what = buildPack(here, { nameOf: (pk) => nameOf(null, pk), hidden: hiddenNow(), draft, maxChars }).label;
      if (wantsMyTone(question) && settings.useMyNotes) what += ", your recent notes";
    } else {
      what = draft ? "Your draft" : "Your question";
    }
    const model = provider.model || "no model chosen";
    line = provider.local ? `${what}, stays on this computer (${model})` : `${what} → ${providerName(provider)} (${model})`;
  }

  const stopRunning = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
  }, []);

  const discard = useCallback(() => {
    turn.current += 1;
    stopRunning();
    pendingConsent.current?.answer(false, false);
    pendingConsent.current = null;
    setConsent(null);
    setAnswer(IDLE);
  }, [stopRunning]);

  // No history: the answer goes when the box is emptied, and with the box.
  const empty = text.trim() === "";
  useEffect(() => {
    if (empty) discard();
  }, [empty, discard]);
  useEffect(() => () => {
    turn.current += 1;
    handle.current?.cancel();
  }, []);

  const fail = (message: string, model = "") =>
    setAnswer({ status: "error", text: "", error: message, needsSettings: /Settings → Assistant|Choose a model|model chosen/.test(message), model });

  const ask = async () => {
    if (!active || answer.status === "waiting" || answer.status === "streaming" || consent) return;
    const { question, draft } = splitInvocation(text);
    if (!question && !draft) return fail("Write a question after @vega.");
    const current = activeProvider(useAssistantStore.getState().settings);
    if (!current.model) return fail("Choose a model in Settings → Assistant.");
    const here: PackSource | null = source?.() ?? null;
    const my = (turn.current += 1);
    stopRunning();

    const { askBeforeCloud, trustedProviders, useMyNotes } = useAssistantStore.getState().settings;
    const address = normalizeAddress(current.baseUrl) ?? current.baseUrl;
    if (!current.local && askBeforeCloud && !trustedProviders.includes(address) && !agreedThisSession.has(address)) {
      const what = here
        ? buildPack(here, { nameOf: (pk) => nameOf(null, pk), hidden: hiddenNow(), draft, maxChars: LIMITS.cloudChars }).label
        : draft ? "Your draft" : "Your question";
      const said = await new Promise<{ send: boolean; always: boolean }>((resolve) => {
        const request: ConsentRequest = { who: providerName(current), what, answer: (send, always) => resolve({ send, always }) };
        pendingConsent.current = request;
        setConsent(request);
      });
      pendingConsent.current = null;
      setConsent(null);
      if (!said.send || my !== turn.current) return;
      agreedThisSession.add(address);
      if (said.always) {
        const latest = useAssistantStore.getState().settings.trustedProviders;
        if (!latest.includes(address)) useAssistantStore.getState().update({ trustedProviders: [...latest, address] });
      }
    }

    setAnswer({ status: "waiting", text: "", error: null, needsSettings: false, model: current.model });

    let myNotes: PackNote[] = [];
    const me = currentAccount();
    if (here && me && useMyNotes && wantsMyTone(question)) {
      try {
        myNotes = (await fetchUserNotes(me, LIMITS.myNotes)).map(toPackNote);
      } catch {
        myNotes = [];
      }
    }
    if (my !== turn.current) return;

    let messages;
    if (here) {
      const names = new Map<string, string>();
      await Promise.all(
        Array.from(new Set(pubkeysOf(here))).map(async (pk) => {
          const profile = await peekCachedProfile(pk).catch(() => undefined);
          names.set(pk, nameOf(profile, pk));
        }),
      );
      if (my !== turn.current) return;
      const pack = buildPack(here, {
        nameOf: (pk) => names.get(pk) ?? nameOf(null, pk),
        hidden: hiddenNow(),
        draft,
        myNotes,
        maxChars: current.local ? LIMITS.localChars : LIMITS.cloudChars,
      });
      messages = askMessages(question, pack);
    } else {
      messages = askMessages(question, { text: draft ? `<draft>\n${draft}\n</draft>` : "", label: "", notes: 0, cut: 0 });
    }

    const asked = askAssistant(current, {
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 1024,
      onText: (piece) => {
        if (my !== turn.current) return;
        setAnswer((a) => (a.status === "stopped" ? a : { ...a, status: "streaming", text: a.text + piece }));
      },
    });
    handle.current = asked;
    try {
      const whole = await asked.done;
      if (my !== turn.current) return;
      setAnswer((a) => {
        const textNow = whole || a.text;
        if (a.status === "stopped") return { ...a, text: a.text || textNow };
        if (!textNow.trim()) return { ...a, status: "error", error: "The model gave no answer. Try again, or check the model in Settings → Assistant.", needsSettings: true };
        return { ...a, status: "done", text: textNow };
      });
    } catch (err) {
      if (my !== turn.current) return;
      fail(String(err).replace(/^Error:\s*/, ""), current.model);
    } finally {
      if (handle.current === asked) handle.current = null;
    }
  };

  const stop = () => {
    // A question still being put together (fetching the user's notes, the names) must not go out
    // after Stop: the next step checks the turn. What has arrived stays on the card.
    turn.current += 1;
    stopRunning();
    setAnswer((a) => (a.status === "waiting" || a.status === "streaming" ? { ...a, status: "stopped" } : a));
  };

  const use = () => {
    const draft = answer.text.trim();
    if (!draft) return;
    discard();
    onUse(draft);
  };

  return {
    /** The text asks Vega: the box's main button asks instead of posting. */
    active,
    /** An answer is on its way. */
    running: answer.status === "waiting" || answer.status === "streaming" || consent !== null,
    ask,
    panel: { line, answer, consent, onStop: stop, onUse: use, onDiscard: discard, onRetry: ask },
  };
}

export type AssistantPanelProps = ReturnType<typeof useAssistantBox>["panel"];
