import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { nip19, type NDKUserProfile } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { fetchProfiles, resolveNip05 } from "../../lib/nostr";
import { peekCachedProfile, primeProfileCache } from "../../hooks/useProfile";
import { nameOf, clipText } from "../../lib/utils";
import { AvatarInitial } from "../shared/AvatarInitial";
import { Dialog } from "../shared/Dialog";
import { Button } from "../shared/Button";

/** How many of the people you follow are listed under the field. */
const MAX_ROWS = 8;
/** Profiles fetched for the list are primed into the shared cache, up to this many: more would evict what the feed is using. */
const PRIME_AT_MOST = 400;

export type KeyRead = { pubkey: string } | { lookup: string } | { error: string } | null;

/**
 * What the field takes besides a name: a public key in either form, with or
 * without the `nostr:` or njump prefix it was copied with, or a NIP-05 address.
 */
export function readKey(raw: string): KeyRead {
  let text = raw.trim();
  if (!text) return null;
  text = text.replace(/^(web\+)?nostr:/i, "").replace(/^https?:\/\/njump\.me\//i, "");
  if (/^nsec1/i.test(text)) return { error: "That is a secret key. Never paste it here: a public key starts with npub1." };
  if (/^[0-9a-f]{64}$/i.test(text)) return { pubkey: text.toLowerCase() };
  if (/^(npub1|nprofile1)/i.test(text)) {
    try {
      const decoded = nip19.decode(text.toLowerCase());
      if (decoded.type === "npub") return { pubkey: decoded.data as string };
      if (decoded.type === "nprofile") return { pubkey: (decoded.data as { pubkey: string }).pubkey };
    } catch { /* not a key after all */ }
    return { error: "That is not a whole public key. Check that all of it was copied." };
  }
  // name@domain, or a bare domain (NIP-05 reads that as _@domain)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) || /^[^\s@]+\.[^\s@]+$/.test(text)) return { lookup: text };
  return null;
}

function matches(profile: NDKUserProfile | null | undefined, pubkey: string, q: string): boolean {
  if (!q) return true;
  const fields = [profile?.name, profile?.displayName, (profile as { display_name?: string } | null)?.display_name, profile?.nip05];
  if (fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q))) return true;
  // A key is matched by its start only, and only once enough of it is typed: "ed" or "cafe" match random keys otherwise.
  return q.length >= 8 && /^[0-9a-f]+$/.test(q) && pubkey.startsWith(q);
}

const LOOKUP = "__lookup__";

/**
 * Start a conversation with someone: by name from the people you follow, or
 * by public key (npub1…, nprofile1…, hex) or NIP-05 address. Until October
 * 2026 the only way in was a monospace field in the corner of the list that
 * took "npub1… or hex pubkey".
 */
export function NewMessageDialog({ onClose, onPick, returnFocus }: { onClose: () => void; onPick: (pubkey: string) => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const follows = useUserStore((s) => s.follows);
  const followsStatus = useUserStore((s) => s.followsStatus);
  const me = useUserStore((s) => s.pubkey);
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<Map<string, NDKUserProfile | null>>(() => new Map());
  const [resolving, setResolving] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; no: number } | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const listId = useId();
  const errorId = useId();
  const lookups = useRef(0);
  const gone = useRef(false);
  // Set on the way in as well: StrictMode runs the cleanup once at mount, which left every lookup's result dropped in development.
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  const say = (text: string) => setError((e) => ({ text, no: (e?.no ?? 0) + 1 }));

  // Names for the people you follow: what the cache has, all asked together, then the rest from the relays.
  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    (async () => {
      const peeked = await Promise.all(follows.map((pk) => peekCachedProfile(pk)));
      if (cancelled) return;
      const have = new Map<string, NDKUserProfile | null>();
      const missing: string[] = [];
      follows.forEach((pk, i) => { if (peeked[i] === undefined) missing.push(pk); else have.set(pk, peeked[i] as NDKUserProfile | null); });
      setProfiles(new Map(have));
      if (missing.length === 0) { setResolving(false); return; }
      try {
        const fetched = await fetchProfiles(missing);
        if (cancelled) return;
        let primed = 0;
        for (const [pk, p] of fetched) { if (primed++ < PRIME_AT_MOST) primeProfileCache(pk, p); have.set(pk, p); }
        setProfiles(new Map(have));
      } catch { /* the rows show as they are */ }
      finally { if (!cancelled) setResolving(false); }
    })();
    return () => { cancelled = true; };
  }, [follows]);

  const q = query.trim().toLowerCase();
  const key = readKey(query);
  // Newest follows first: the list is appended to as people are followed.
  const people = key && "pubkey" in key ? [] : [...follows].reverse().filter((pk) => matches(profiles.get(pk), pk, q)).slice(0, MAX_ROWS);
  const lookup = key && "lookup" in key ? key.lookup : null;
  const options = lookup ? [...people, LOOKUP] : people;
  const chosen = highlight && options.includes(highlight) ? highlight : options[0] ?? null;

  const take = (pubkey: string) => {
    if (pubkey === me) { say("That's you."); return; }
    onPick(pubkey);
  };

  const submit = async () => {
    if (lookingUp) return;
    if (chosen && chosen !== LOOKUP) { take(chosen); return; }
    if (!key) {
      if (!q) return;
      say(resolving ? "Still loading the names of the people you follow. Try again in a moment." : `No one you follow is called "${clipText(query.trim(), 40)}". Paste their public key (npub1…) or their name@domain.`);
      return;
    }
    if ("error" in key) { say(key.error); return; }
    if ("pubkey" in key) { take(key.pubkey); return; }
    // The lookup: numbered, so a result for a query that changed, or for a dialog that closed, is dropped.
    const no = ++lookups.current;
    setLookingUp(key.lookup);
    setError(null);
    const found = await resolveNip05(key.lookup).catch(() => null);
    if (gone.current || no !== lookups.current) return;
    setLookingUp(null);
    if (found) take(found);
    else say(`No one found at ${clipText(key.lookup, 60)}.`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const at = chosen ? options.indexOf(chosen) : -1;
    if (e.key === "ArrowDown") { e.preventDefault(); if (options.length) setHighlight(options[Math.min(at + 1, options.length - 1)]); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (options.length) setHighlight(options[Math.max(at - 1, 0)]); }
    else if (e.key === "Enter") { e.preventDefault(); void submit(); }
  };

  const followsLine = follows.length > 0 ? null
    : followsStatus === "loaded" ? "You follow nobody yet. Paste a public key (npub1…) or a name@domain address."
    : followsStatus === "unknown" ? "Your follow list could not be loaded, so nobody is listed here. You can still paste a public key (npub1…) or a name@domain address."
    : "Loading the people you follow…";

  return (
    <Dialog title="New message" onClose={onClose} returnFocus={returnFocus} closeOnBackdrop={!query.trim()}>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); setHighlight(null); lookups.current++; setLookingUp(null); }}
            onKeyDown={onKeyDown}
            placeholder="Name, name@domain, or npub1…"
            aria-label="Who to message"
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={options.length > 0 ? listId : undefined}
            aria-activedescendant={chosen ? `${listId}-${chosen}` : undefined}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            spellCheck={false}
            className="flex-1 min-w-0 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui rounded-lg focus:outline-none focus:border-accent placeholder:text-text-dim"
            style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
          />
          <Button variant="primary" onClick={() => void submit()} busy={lookingUp !== null} disabled={!query.trim() && options.length === 0}>
            {lookingUp ? "Looking up…" : "Start"}
          </Button>
        </div>
        {/* Keyed by its number: the same sentence a second time is read out again. */}
        {error && <p key={error.no} id={errorId} role="alert" className="text-danger text-caption">{error.text}</p>}
        {options.length > 0 && (
          <div>
            <p className="text-text-muted text-caption mb-1">{q ? "People you follow" : "People you follow, newest first"}</p>
            <ul id={listId} role="listbox" aria-label="People you follow" className="border border-border rounded-lg overflow-hidden">
              {people.map((pk) => <PersonRow key={pk} id={`${listId}-${pk}`} pubkey={pk} profile={profiles.get(pk)} active={pk === chosen} onPick={() => take(pk)} onHover={() => setHighlight(pk)} />)}
              {lookup && (
                <li id={`${listId}-${LOOKUP}`} role="option" aria-selected={chosen === LOOKUP} onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()} onMouseMove={() => setHighlight(LOOKUP)}
                  className={`flex items-center gap-3 px-3 py-2 border-l-2 cursor-pointer transition-colors ${chosen === LOOKUP ? "border-l-accent bg-accent/10" : "border-l-transparent hover:bg-text/8"}`}>
                  <span className="w-8 h-8 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-muted text-caption shrink-0" aria-hidden>@</span>
                  <span className="min-w-0 flex-1 text-text text-body truncate">Look up {lookup}</span>
                </li>
              )}
            </ul>
          </div>
        )}
        {options.length === 0 && !q && followsLine && <p className="text-text-muted text-caption">{followsLine}</p>}
        {options.length === 0 && q && resolving && !key && <p className="text-text-muted text-caption">Still loading the names of the people you follow…</p>}
      </div>
    </Dialog>
  );
}

function PersonRow({ id, pubkey, profile, active, onPick, onHover }: { id: string; pubkey: string; profile: NDKUserProfile | null | undefined; active: boolean; onPick: () => void; onHover: () => void }) {
  const name = nameOf(profile, pubkey);
  const picture = typeof profile?.picture === "string" ? profile.picture : undefined;
  const nip05 = typeof profile?.nip05 === "string" ? profile.nip05 : undefined;
  // An option in a listbox: the field keeps focus, the row is reached by arrow keys or the pointer.
  // The press is swallowed before it moves focus, so the field keeps it.
  return (
    <li id={id} role="option" aria-selected={active} onMouseDown={(e) => e.preventDefault()} onClick={onPick} onMouseMove={onHover}
      className={`flex items-center gap-3 px-3 py-2 border-l-2 cursor-pointer transition-colors ${active ? "border-l-accent bg-accent/10" : "border-l-transparent hover:bg-text/8"}`}>
      {picture ? (
        <img src={picture} alt="" className="w-8 h-8 rounded-full object-cover bg-bg-raised shrink-0" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <span className="w-8 h-8 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-muted text-caption shrink-0" aria-hidden><AvatarInitial profile={profile} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-text text-body font-medium truncate">{name}</span>
        {nip05 && <span className="block text-text-muted text-caption truncate">{nip05}</span>}
      </span>
    </li>
  );
}
