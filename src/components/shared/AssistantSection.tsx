import { useEffect, useRef, useState } from "react";
import { Switch } from "./Switch";
import { Button } from "./Button";
import { useAssistantStore } from "../../stores/assistant";
import { PRESETS, PRESET_ORDER, activeProvider, normalizeAddress } from "../../lib/assistant/settings";
import type { PresetId } from "../../types/assistant";
import {
  assistantKeyStatus,
  forgetAssistantKey,
  listAssistantModels,
  saveAssistantKey,
  testAssistant,
} from "../../lib/assistant/client";
import { clipText, endSentence } from "../../lib/utils";

const FIELD =
  "w-full bg-bg border border-border-strong px-3 py-1.5 text-text text-ui font-mono placeholder:text-text-dim focus:outline-none focus:border-accent rounded-lg";
const LABEL = "text-micro font-medium uppercase tracking-widest mb-2 text-text-dim";

function reason(err: unknown): string {
  return endSentence(clipText(String(err), 200));
}

/** Two addresses are the same when Rust would save them as the same (`normalize_base`). */
function sameAddress(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const left = normalizeAddress(a);
  return left !== null && left === normalizeAddress(b);
}

type TestState = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "failed"; reason: string };

/**
 * Settings → Assistant: the assistant that reads what is on screen and drafts, which you then edit
 * and sign (CLAUDE.md, "The assistant"). Off until switched on. The key goes to the OS keychain through Rust and is never shown again, only whether one is
 * saved and for which address.
 */
export function AssistantSection() {
  const settings = useAssistantStore((s) => s.settings);
  const update = useAssistantStore((s) => s.update);
  const provider = activeProvider(settings);
  const preset = PRESETS[settings.preset];

  const [keyFor, setKeyFor] = useState<string | null | undefined>(undefined);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ state: "idle" });
  // Which provider, address and model the results on screen belong to. Save, Remove, Find models
  // and Test each note it when they start and drop their result if it has moved on by the time
  // they finish: a slow Ollama test must not say Claude is connected.
  const inputs = `${settings.preset}|${provider.baseUrl}|${provider.model}`;
  const current = useRef(inputs);
  current.current = inputs;
  const target = `${settings.preset}|${provider.baseUrl}`;
  // A key is about the provider and the address only: a model edited while it saves changes nothing.
  const currentTarget = useRef(target);
  currentTarget.current = target;

  // A key typed for one destination is never saved for another: a change of provider or address
  // clears it, and the results that were about the last one.
  useEffect(() => {
    setKeyInput("");
    setKeyError(null);
    setModels([]);
    setModelsError(null);
    setTest({ state: "idle" });
  }, [target]);

  // A changed model makes the last Test's verdict stale.
  useEffect(() => {
    setTest({ state: "idle" });
  }, [provider.model]);

  // What the keychain holds for this provider, read again when the provider changes.
  useEffect(() => {
    setKeyFor(undefined);
    if (!preset.keySlot || !settings.enabled) return;
    let live = true;
    assistantKeyStatus(preset.keySlot)
      .then((saved) => live && setKeyFor(saved))
      .catch((e) => live && setKeyError(`Couldn't read the keychain: ${reason(e)}`));
    return () => {
      live = false;
    };
  }, [preset.keySlot, settings.enabled]);

  const choose = (id: PresetId) => update({ preset: id });
  const setBaseUrl = (value: string) => update({ baseUrl: { ...settings.baseUrl, [preset.id]: value } });
  const setModel = (value: string) => update({ model: { ...settings.model, [preset.id]: value } });

  const keySaved = sameAddress(keyFor, provider.baseUrl);

  const saveKey = async () => {
    const slot = preset.keySlot;
    if (!slot || !keyInput.trim()) return;
    const started = currentTarget.current;
    setKeyBusy(true);
    setKeyError(null);
    try {
      await saveAssistantKey(slot, provider.baseUrl, keyInput);
      const saved = await assistantKeyStatus(slot);
      if (currentTarget.current !== started) return;
      setKeyInput("");
      setKeyFor(saved);
    } catch (e) {
      if (currentTarget.current === started) setKeyError(`Couldn't save the key: ${reason(e)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    const slot = preset.keySlot;
    if (!slot) return;
    const started = currentTarget.current;
    setKeyBusy(true);
    setKeyError(null);
    try {
      await forgetAssistantKey(slot);
      if (currentTarget.current === started) setKeyFor(null);
    } catch (e) {
      if (currentTarget.current === started) setKeyError(`Couldn't remove the key: ${reason(e)}`);
    } finally {
      setKeyBusy(false);
    }
  };

  const findModels = async () => {
    const started = current.current;
    setModelsBusy(true);
    setModelsError(null);
    try {
      const found = await listAssistantModels(provider);
      if (current.current !== started) return;
      setModels(found);
      if (found.length === 0) setModelsError("The server lists no models.");
      else if (!provider.model) setModel(found[0]);
    } catch (e) {
      if (current.current === started) setModelsError(`Couldn't list the models: ${reason(e)}`);
    } finally {
      setModelsBusy(false);
    }
  };

  const runTest = async () => {
    const started = current.current;
    setTest({ state: "testing" });
    const result = await testAssistant(provider);
    if (current.current !== started) return;
    setTest(result.ok ? { state: "ok" } : { state: "failed", reason: reason(result.reason) });
  };

  const needsKey = preset.kind === "anthropic" && !keySaved;
  const testBlocked = !provider.model || !provider.baseUrl || needsKey;

  return (
    <section className="space-y-4">
      <Switch
        checked={settings.enabled}
        onChange={(on) => update({ enabled: on })}
        label="Use an assistant to read and draft"
        hint={
          settings.enabled
            ? "Start a note or a reply with @vega and a question. The assistant reads what is open and writes drafts; you edit them and post them yourself."
            : "An assistant that answers questions about what is open and drafts notes for you to edit and post. Nothing is sent to a model until you ask."
        }
      />

      {settings.enabled && (
        <div className="ml-12 space-y-5">
          <div>
            <h3 className={LABEL} id="assistant-provider-label">Model</h3>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="assistant-provider-label">
              {PRESET_ORDER.map((id) => (
                <Button key={id} size="sm" pressed={settings.preset === id} onClick={() => choose(id)}>
                  {PRESETS[id].label}
                </Button>
              ))}
            </div>
            <p className="text-text-muted text-caption mt-2 px-1">
              {provider.local
                ? "Runs on this computer: what you ask about stays here."
                : `What you ask about is sent to ${preset.id === "claude" ? "Anthropic" : "this server"}, under its terms.`}
            </p>
          </div>

          {preset.baseUrlEditable ? (
            <div>
              <label className={LABEL + " block"} htmlFor="assistant-address">Address</label>
              <input
                id="assistant-address"
                className={FIELD}
                value={settings.baseUrl[preset.id] ?? preset.defaultBaseUrl}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          ) : null}

          <div>
            <label className={LABEL + " block"} htmlFor="assistant-model">Model name</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="assistant-model"
                className={FIELD + " flex-1 min-w-48 w-auto"}
                value={settings.model[preset.id] ?? preset.defaultModel}
                placeholder={preset.id === "ollama" ? "llama3.2" : "model name"}
                list="assistant-models"
                spellCheck={false}
                onChange={(e) => setModel(e.target.value)}
              />
              <Button size="sm" onClick={findModels} busy={modelsBusy} disabled={!provider.baseUrl || needsKey}>
                Find models
              </Button>
            </div>
            <datalist id="assistant-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {modelsError && <p role="alert" className="text-danger text-caption mt-1">{modelsError}</p>}
          </div>

          {preset.keySlot && (
            <div>
              <label className={LABEL + " block"} htmlFor="assistant-key">API key</label>
              {keySaved ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-text text-ui">Saved in your keychain.</p>
                  <Button size="sm" variant="ghost" tone="danger" onClick={removeKey} busy={keyBusy}>
                    Remove
                  </Button>
                </div>
              ) : (
                <>
                  {keyFor && (
                    <p className="text-text-muted text-caption mb-2">
                      A key is saved for {keyFor}, which is not this address. A key is only ever sent to the address it was saved for.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="assistant-key"
                      type="password"
                      autoComplete="off"
                      className={FIELD + " flex-1 min-w-48 w-auto"}
                      value={keyInput}
                      placeholder={preset.id === "claude" ? "sk-ant-…" : "the server's API key"}
                      spellCheck={false}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter that picks an input method's candidate is not a save (CLAUDE.md, "Names").
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) saveKey();
                      }}
                    />
                    <Button size="sm" onClick={saveKey} busy={keyBusy} disabled={!keyInput.trim() || !provider.baseUrl}>
                      Save key
                    </Button>
                  </div>
                  <p className="text-text-muted text-caption mt-2">
                    Kept in your system's keychain, like your secret key, and sent only to {provider.baseUrl || "this address"}.
                    {preset.id === "custom" ? " Leave it empty for a server that needs none." : ""}
                  </p>
                </>
              )}
              {keyError && <p role="alert" className="text-danger text-caption mt-1">{keyError}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={runTest} busy={test.state === "testing"} disabled={testBlocked}>
              Test
            </Button>
            {test.state === "ok" && <p className="text-success text-ui">Connected: {provider.model} answered.</p>}
            {test.state === "failed" && <p role="alert" className="text-danger text-ui">{test.reason}</p>}
            {test.state === "idle" && testBlocked && (
              <p className="text-text-muted text-caption">
                {needsKey ? "Save an API key first." : "Choose a model first."}
              </p>
            )}
          </div>

          <Switch
            checked={settings.useMyNotes}
            onChange={(on) => update({ useMyNotes: on })}
            label="Use my recent notes when drafting in my tone"
            hint="When you ask for a draft in your tone, your latest notes go along with the question, so the model can match how you write."
          />
          <Switch
            checked={settings.askBeforeCloud}
            onChange={(on) => update({ askBeforeCloud: on, ...(on ? {} : { trustedProviders: [] }) })}
            label="Ask before sending to a model that is not on this computer"
            hint="Once for each provider. Messages, keys and the notes of people you mute are never sent."
          />
          {/* "Don't ask again" was otherwise invisible, and undone only by switching this off and on. */}
          {settings.askBeforeCloud && settings.trustedProviders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-text-muted text-caption">Not asking again about: {settings.trustedProviders.map(providerLabel).join(", ")}</p>
              <Button size="sm" variant="ghost" onClick={() => update({ trustedProviders: [] })}>Ask again</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A provider not asked about, by the name the question used: "Anthropic", or the server's host. */
function providerLabel(address: string): string {
  if (address === normalizeAddress(PRESETS.claude.defaultBaseUrl)) return "Anthropic";
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
