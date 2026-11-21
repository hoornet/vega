import { createContext, useContext, type ReactNode } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import type { PackNote, PackSource } from "../../lib/assistant/context";

/**
 * Where a box is, for the assistant: a view puts what it shows here (a thread, an article, a
 * profile, the feed), and a box under it asks for it when the user asks Vega. A getter, read when
 * it is needed, so a view does not rebuild a pack on every render.
 */
export type SourceGetter = () => PackSource | null;

const AssistantSourceContext = createContext<SourceGetter | null>(null);

export function AssistantSourceProvider({ source, children }: { source: SourceGetter; children: ReactNode }) {
  return <AssistantSourceContext.Provider value={source}>{children}</AssistantSourceContext.Provider>;
}

/** What the view this box sits in shows, or null outside one. */
export function useAssistantSource(): SourceGetter | null {
  return useContext(AssistantSourceContext);
}

export function toPackNote(event: NDKEvent): PackNote {
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at ?? 0,
    kind: event.kind ?? 1,
    content: event.content ?? "",
  };
}

/**
 * What a reply box asks about: in a thread or on a profile, that view with the note answered
 * marked; anywhere else (the feed, a search, a hashtag), the note alone.
 */
export function replySource(parent: SourceGetter | null, replyTo: NDKEvent): SourceGetter {
  return () => {
    const note = toPackNote(replyTo);
    const around = parent?.();
    if (around?.kind === "thread" || around?.kind === "profile") return { ...around, replyTo: note };
    return { kind: "note", note };
  };
}
