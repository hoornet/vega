import { useEffect, useRef, useState } from "react";
import { getNDK, getStoredRelayUrls, addRelay, removeRelay, publishRelayList, fetchRelayRecommendations, normalizeRelayUrl, isOutboxRelaysEnabled, setOutboxRelaysEnabled, resetNDK } from "../../lib/nostr";
import {
  authenticatedRelayUrls,
  getPendingAuthRelays,
  getRelayAuthScope,
  rechallengeRelays,
  setRelayAuthScope,
  type RelayAuthScope,
} from "../../lib/nostr/relayAuth";
import { useRelayHealthStore } from "../../stores/relayHealth";
import { useUserStore, useCanSign } from "../../stores/user";
import type { RelayHealthResult } from "../../lib/nostr/relayHealth";
import { ViewHeader } from "./ViewHeader";
import { Switch } from "./Switch";
import { Button } from "./Button";
import { useToastStore } from "../../stores/toast";
import { useRelayStatus } from "../../hooks/useRelayStatus";
import { useRelayListShare } from "../../stores/relayListShare";
import { useFeedStore } from "../../stores/feed";
import { useEscapeToClose } from "../../hooks/useEscapeToClose";
import { ChevronDown, ChevronRight, Trash2, X } from "lucide-react";
import { tellPublish } from "../../lib/publishFeedback";

function statusColor(status: RelayHealthResult["status"]): string {
  switch (status) {
    case "online": return "bg-success";
    case "slow": return "bg-warning";
    case "offline": return "bg-danger";
  }
}

/** One word, the same everywhere: a dot and a word said two different things ("offline" beside "NDK connected"). */
function statusLabel(status: RelayHealthResult["status"]): string {
  switch (status) {
    case "online": return "connected";
    case "slow": return "slow";
    case "offline": return "not answering";
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function NipBadges({ nips }: { nips: number[] }) {
  if (nips.length === 0) return null;
  const sorted = [...nips].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {sorted.map((n) => (
        <span key={n} className="px-1 py-0 text-micro border border-border text-text-dim rounded-sm">
          NIP-{String(n).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}


/** The relay's name when it has one, and its address second: a `wss://` URL is not a name. */
function RelayName({ url, name }: { url: string; name?: string | null }) {
  const host = url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
  // Spans, since this also sits inside the details button.
  return (
    <span className="flex-1 min-w-0 block">
      <span className="block text-text text-ui truncate" title={url}>{name || host}</span>
      {name && <span className="block text-text-muted text-caption font-mono truncate">{host}</span>}
    </span>
  );
}

/** What a checked relay's row says. A probe that failed while the pool holds a connection is said as that, not as "not answering". */
function wordFor(result: RelayHealthResult, poolConnected: boolean): { word: string; dot: string; tone: string } {
  if (result.status === "offline" && poolConnected) return { word: "connected, didn't answer the check", dot: "bg-warning", tone: "text-warning" };
  return { word: statusLabel(result.status), dot: statusColor(result.status), tone: result.status === "offline" ? "text-danger" : "text-text-muted" };
}

/** One of your relays: a status dot and word, the latency, details on demand, and Remove. */
function RelayHealthCard({ result, poolConnected, onRemove }: { result: RelayHealthResult; poolConnected: boolean; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const nip11 = result.nip11;
  const said = wordFor(result, poolConnected);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex items-center gap-3 flex-1 min-w-0 text-left" title={expanded ? "Hide details" : "Show details"}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${said.dot}`} aria-hidden />
          <RelayName url={result.url} name={nip11?.name} />
          <span className="flex items-center gap-3 shrink-0 text-caption">
            {result.latencyMs !== null && (
              // Amber from the same point "slow" starts, 3 s, not before.
              <span className={`font-mono ${result.latencyMs >= 3000 ? "text-warning" : "text-text-muted"}`}>{formatLatency(result.latencyMs)}</span>
            )}
            <span className={said.tone}>{said.word}</span>
            {expanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
          </span>
        </button>
        {/* Always visible, 28px: it was 35x16, hover-only, and instant. The toast's Undo puts the relay back. */}
        <Button square size="sm" variant="ghost" tone="danger" onClick={onRemove} aria-label={`Remove ${result.url}`} title="Remove from your list"><X /></Button>
      </div>

      {expanded && (
        <div className="px-3 py-2 border-t border-border-subtle bg-bg-raised text-caption space-y-1.5">
          {nip11 ? (
            <>
              {nip11.description && (
                <p className="text-text-muted">{nip11.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
                {nip11.software && (
                  <div>
                    <span className="text-text-muted">Software: </span>
                    <span className="text-text">{nip11.software}{nip11.version ? ` ${nip11.version}` : ""}</span>
                  </div>
                )}
                {nip11.contact && (
                  <div>
                    <span className="text-text-muted">Contact: </span>
                    <span className="text-text">{nip11.contact}</span>
                  </div>
                )}
                {nip11.pubkey && (
                  <div className="col-span-2">
                    <span className="text-text-muted">Pubkey: </span>
                    <span className="text-text font-mono">{nip11.pubkey.slice(0, 16)}…</span>
                  </div>
                )}
              </div>
              {nip11.supported_nips && nip11.supported_nips.length > 0 && (
                <div>
                  <NipBadges nips={nip11.supported_nips} />
                </div>
              )}
            </>
          ) : (
            <p className="text-text-muted">No details from this relay{result.error ? ` — ${result.error}` : ""}</p>
          )}
          <div className="text-text-muted text-micro">
            Checked {checkedAt(result.checkedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A relay without a check result: one of yours awaiting its check ("not checked
 * yet": nothing is known, so nothing is claimed), or one reached automatically
 * ("connected" / "not connected", which is all the pool knows).
 */
function RelayPoolRow({ url, connected, kind, onRemove }: { url: string; connected: boolean; kind: "mine" | "extra"; onRemove?: () => void }) {
  const word = kind === "mine" ? (connected ? "connected" : "not checked yet") : connected ? "connected" : "not connected";
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg">
      <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? "bg-success" : "bg-text-dim"}`} aria-hidden />
      <RelayName url={url} />
      <span className="text-text-muted text-caption shrink-0">{word}</span>
      {onRemove && <Button square size="sm" variant="ghost" tone="danger" onClick={onRemove} aria-label={`Remove ${normalizeRelayUrl(url)}`} title="Remove from your list"><X /></Button>}
    </div>
  );
}

const checkedAt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The relay list. Rebuilt after the October 2026 UI review: nothing said what
 * a relay was; relays the user chose and relays Vega reached on its own sat
 * in identical rows, so "4 relays" in Export showed as eight here; a relay
 * that failed one three-second probe was red, "offline", and one click from a
 * danger-coloured "Remove dead", while the same row's purple dot said it was
 * connected; per-row remove was hover-only, 35x16px, instant, with no undo;
 * and "Publish list" said nothing about what was published or to whom.
 */
export function RelaysView() {
  const { results: allResults, checking, lastChecked, checkAll } = useRelayHealthStore();
  const canSign = useCanSign();
  const { loggedIn } = useUserStore();
  // The pool through the hook that polls it, so the counts move when Relay reach is flipped and NDK is rebuilt.
  const pool = useRelayStatus();
  const poolConnectedUrls = new Set(pool.relays.filter((r) => r.connected).map((r) => normalizeRelayUrl(r.url)));
  const configured = new Set(getStoredRelayUrls().map(normalizeRelayUrl));
  // Results for relays still in the list: a relay removed while a check ran must not be drawn from that check.
  const results = allResults.filter((r) => configured.has(normalizeRelayUrl(r.url)));
  const networkUp = useFeedStore((s) => s.connected);
  const { unshared, mark: markUnshared } = useRelayListShare();

  const [input, setInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const offerButton = useRef<HTMLButtonElement>(null);
  // Escape backs out of the confirmation, like every other floating thing; focus goes back to the offer.
  const keepRelays = () => { setConfirmOffline(false); requestAnimationFrame(() => offerButton.current?.focus()); };
  useEscapeToClose(keepRelays, confirmOffline);

  // Auto-check on first mount if no results yet
  useEffect(() => {
    if (results.length === 0 && !checking) {
      checkAll();
    }
  }, []);

  const isUp = (r: RelayHealthResult) => poolConnectedUrls.has(normalizeRelayUrl(r.url));
  // Offered for removal: relays that did not answer the check AND are not connected right now.
  // One failed probe is weak evidence; a relay the pool holds a connection to is not dead.
  const deadRelays = results.filter((r) => r.status === "offline" && !isUp(r));
  const connectedCount = results.filter((r) => r.status === "online" || (r.status === "offline" && isUp(r))).length;
  const slowCount = results.filter((r) => r.status === "slow").length;
  // With the network gone every probe fails and every socket closes: that is not four dead relays, and
  // confirming would empty the list. Judged by the connection monitor, and by the list itself: every
  // checked relay failed and none of yours is connected. Never offer to remove the whole list either.
  const anyMineUp = Array.from(configured).some((url) => poolConnectedUrls.has(url));
  const networkDown = !networkUp || (results.length > 0 && !anyMineUp && results.every((r) => r.status === "offline"));
  const offerRemoval = !networkDown && deadRelays.length > 0 && deadRelays.length < configured.size;

  const handleAddRelay = () => {
    const url = input.trim();
    if (!url) return;
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      setAddError("A relay address starts with wss://");
      return;
    }
    if (getStoredRelayUrls().includes(normalizeRelayUrl(url))) {
      setAddError("Already in your list");
      return;
    }
    addRelay(url);
    setInput("");
    setAddError(null);
    markUnshared(true);
    checkAll();
  };

  const handleRemoveRelay = (rawUrl: string) => {
    const url = normalizeRelayUrl(rawUrl);
    removeRelay(url);
    markUnshared(true);
    void checkAll();
    const host = url.replace(/^wss?:\/\//, "");
    useToastStore.getState().addToast(`Removed ${host} from your relays.`, "info", {
      key: `relay-removed:${url}`,
      // Undo may run after this view is gone: it marks the list through the store, not through this render.
      action: { label: "Undo", run: () => { addRelay(url); useRelayListShare.getState().mark(true); void useRelayHealthStore.getState().checkAll(); } },
    });
  };

  const handleRemoveOffline = async () => {
    setConfirmOffline(false);
    setRemoving(true);
    try {
      for (const r of deadRelays) removeRelay(r.url);
      markUnshared(true);
      await checkAll();
    } finally {
      setRemoving(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    // The marker is cleared only for the list as it was when the share began: an add made meanwhile is still unshared.
    const shared = getStoredRelayUrls().join("\n");
    const told = await tellPublish(() => publishRelayList(getStoredRelayUrls()), { done: "Relay list shared.", kept: "Your relays here are unchanged.", verb: "share your relay list" });
    if (told.ok && getStoredRelayUrls().join("\n") === shared) markUnshared(false);
    setSharing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddRelay();
    if (e.key === "Escape") setInput("");
  };

  // Your relays: the health results, then every relay in the stored list not checked yet, whether or
  // not it has made it into the pool (a configured relay must never vanish from its own list).
  const checkedUrls = new Set(results.map((r) => normalizeRelayUrl(r.url)));
  const uncheckedMine = Array.from(configured).filter((url) => !checkedUrls.has(url)).map((url) => ({ url, connected: poolConnectedUrls.has(url) }));
  // Extra reach: what NDK pulled in on its own. Not removable: it is not in the list.
  const extra = pool.relays.filter((r) => r.origin === "discovered");

  // Sort: connected first, then slow, then not answering
  const sortedResults = [...results].sort((a, b) => {
    const order = { online: 0, slow: 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Relays"
        meta={results.length > 0 ? (
          <span className="flex items-center gap-2">
            {connectedCount > 0 && <span className="text-success">{connectedCount} connected</span>}
            {slowCount > 0 && <span className="text-warning">{slowCount} slow</span>}
            {deadRelays.length > 0 && <span className="text-danger">{deadRelays.length} not answering</span>}
          </span>
        ) : undefined}
        actions={
          <>
            {lastChecked && (
              <span className="text-text-muted text-caption">Checked {checkedAt(lastChecked)}</span>
            )}
            <Button onClick={checkAll} busy={checking}>{checking ? "Checking…" : "Check now"}</Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto content-column">
        <div className="p-4 space-y-8">
          <p className="text-text-muted text-caption">
            Relays are the servers Vega gets posts from and sends yours to. The defaults work; you can leave this alone.
          </p>

          {/* Your relays */}
          <section aria-labelledby="relays-mine">
            <h2 id="relays-mine" className="text-body font-medium text-text mb-3">Your relays</h2>
            <div className="flex flex-wrap gap-2">
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value); setAddError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="wss://relay.example.com"
                aria-label="Relay address"
                className="flex-1 min-w-48 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui font-mono focus:outline-none focus:border-accent placeholder:text-text-dim rounded-lg"
              />
              <Button onClick={handleAddRelay}>Add</Button>
            </div>
            {addError && <p className="text-danger text-caption mt-1">{addError}</p>}

            <div className="space-y-1 mt-3">
              {sortedResults.map((result) => (
                <RelayHealthCard key={result.url} result={result} poolConnected={isUp(result)} onRemove={() => handleRemoveRelay(result.url)} />
              ))}
              {uncheckedMine.map((relay) => (
                <RelayPoolRow key={relay.url} url={relay.url} connected={relay.connected} kind="mine" onRemove={() => handleRemoveRelay(relay.url)} />
              ))}
            </div>
            {results.length === 0 && !checking && uncheckedMine.length === 0 && (
              <p className="text-text-muted text-body mt-3">No relays in your list.</p>
            )}
            {checking && results.length === 0 && (
              <div className="flex items-center gap-2 text-text-muted text-body py-6 justify-center">
                <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Checking your relays…
              </div>
            )}

            {/* With no relay reachable, nothing is "dead": the network is. */}
            {networkDown && results.length > 0 && (
              <p className="text-text-muted text-caption mt-3">Vega couldn't reach any relay. Check your connection; nothing is offered for removal while it is down.</p>
            )}

            {/* Removal of what did not answer: named, confirmed, never for a relay the pool is connected to, never the whole list. */}
            {offerRemoval && !removing && (
              confirmOffline ? (
                <div role="alertdialog" aria-labelledby="relays-remove-offline" className="mt-3 border border-border rounded-lg p-3 bg-bg-raised">
                  <p id="relays-remove-offline" className="text-text text-body">
                    Remove {deadRelays.map((r) => r.url.replace(/^wss?:\/\//, "").replace(/\/$/, "")).join(", ")} from your list?
                  </p>
                  <p className="text-text-muted text-caption mt-1">{deadRelays.length === 1 ? "It did not answer" : "They did not answer"} the last check. A relay that is only slow today comes back if you keep it.</p>
                  <div className="flex gap-2 mt-3">
                    <Button variant="primary" tone="danger" onClick={() => void handleRemoveOffline()}><Trash2 />Remove</Button>
                    {/* Keep has focus, as Cancel does in the account removal: the offer button is gone, and a stray Enter must not remove. */}
                    <Button variant="ghost" onClick={keepRelays} autoFocus>Keep</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <Button ref={offerButton} variant="ghost" tone="danger" onClick={() => setConfirmOffline(true)}>
                    <Trash2 />Remove {deadRelays.length} relay{deadRelays.length > 1 ? "s" : ""} not answering…
                  </Button>
                </div>
              )
            )}

            {canSign && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={() => void handleShare()} busy={sharing} aria-describedby={unshared ? "relays-unshared" : undefined}>
                  {sharing ? "Sharing…" : "Share my relay list"}
                </Button>
                {/* On the canvas, not on the button's fill: a warning colour on the secondary fill is under 4.5:1 in the light themes. */}
                {unshared && <span id="relays-unshared" className="text-caption text-warning">not shared yet</span>}
                <p className="text-text-muted text-caption flex-1 min-w-48">Tells other apps and people where to find your posts. Do this after changing the list.</p>
              </div>
            )}
          </section>

          {/* Extra reach */}
          <section aria-labelledby="relays-extra">
            {/* The heading holds the button: a heading inside a button is not a heading to a screen reader. */}
            <h2 className="text-body font-medium text-text">
              <button type="button" onClick={() => setShowExtra((v) => !v)} aria-expanded={showExtra} className="flex items-center gap-2 text-left hover:text-accent transition-colors">
                {showExtra ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
                {/* The section is named by the words alone, not by the count beside them. */}
                <span id="relays-extra">Extra reach, found automatically</span>
                <span className="text-text-muted text-caption font-normal">{extra.length}</span>
              </button>
            </h2>
            <div className="mt-3">
              <RelayReachToggle />
            </div>
            {showExtra && (
              <div className="space-y-1 mt-3">
                {extra.length === 0 && <p className="text-text-muted text-caption">None right now.</p>}
                {extra.map((relay) => (
                  <RelayPoolRow key={relay.url} url={relay.url} connected={relay.connected} kind="extra" />
                ))}
              </div>
            )}
          </section>

          <RelayAuthToggle />

          {loggedIn && <SuggestedRelays onAdded={() => { markUnshared(true); checkAll(); }} />}
        </div>
      </div>
    </div>
  );
}

/** NIP-42: which relays Vega proves your identity to. The same words as the list they are about. */
function RelayAuthToggle() {
  const [scope, setScope] = useState<RelayAuthScope>(getRelayAuthScope);

  const choose = (next: RelayAuthScope) => {
    if (next === scope) return;
    setScope(next);
    setRelayAuthScope(next);
    const instance = getNDK();
    if (next === "configured") {
      rechallengeRelays(instance, authenticatedRelayUrls(instance));
    } else {
      rechallengeRelays(instance, getPendingAuthRelays().declined);
    }
  };

  const options: { value: RelayAuthScope; label: string }[] = [
    { value: "configured", label: "Only my relays" },
    { value: "any", label: "Any relay that asks" },
  ];

  return (
    <section aria-labelledby="relays-auth">
      <h2 id="relays-auth" className="text-body font-medium text-text">Prove who you are to</h2>
      <div className="flex flex-wrap items-center gap-2 mt-2" role="group" aria-labelledby="relays-auth">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => choose(opt.value)}
            aria-pressed={scope === opt.value}
            className={`px-3 py-1.5 text-ui border transition-colors ${
              scope === opt.value
                ? "border-accent text-accent"
                : "border-border text-text-muted hover:text-text hover:border-accent/40"
            } rounded-sm`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-text-muted text-caption mt-1.5">
        {scope === "configured"
          ? "Some relays hide private messages until you identify yourself. Vega only does that for your relays."
          : "Any relay that asks learns your identity, including the relays Vega reached on its own."}
      </p>
    </section>
  );
}

/** NIP-65 outbox, in the user's words (the review's wording, used only here now; Settings points here). */
function RelayReachToggle() {
  const [enabled, setEnabled] = useState(isOutboxRelaysEnabled);
  const [applying, setApplying] = useState(false);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    setOutboxRelaysEnabled(next);
    // enableOutboxModel is read once in the NDK constructor.
    setApplying(true);
    try {
      await resetNDK();
    } finally {
      setApplying(false);
    }
  };

  return (
    <Switch
      checked={enabled}
      onChange={() => toggle()}
      busy={applying}
      label="Also look on the relays that people I follow use"
      hint={
        <>
          {enabled
            ? "You miss fewer posts. Vega also connects to servers you did not choose, and each one can see your IP address."
            : "Vega only talks to your relays. Posts from people who publish elsewhere will not appear."}
          {applying && " Reconnecting…"}
        </>
      }
    />
  );
}

function SuggestedRelays({ onAdded }: { onAdded: () => void }) {
  const { follows, followsStatus } = useUserStore();
  // The reason it is unavailable, true to the follow list's state: "follow a few people first" while the list loads is a false reason.
  const why = follows.length > 0 ? "Based on the relays the people you follow use."
    : followsStatus === "loaded" ? "Follow a few people first: suggestions come from the relays they use."
    : followsStatus === "unknown" ? "Your follow list could not be loaded, so there is nothing to suggest from yet."
    : "Loading the people you follow…";
  const [suggestions, setSuggestions] = useState<{ url: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleDiscover = async () => {
    setLoading(true);
    try {
      const results = await fetchRelayRecommendations(follows, getStoredRelayUrls());
      setSuggestions(results);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (url: string) => {
    addRelay(url);
    setSuggestions((prev) => prev.filter((s) => s.url !== url));
    // The list above renders from the parent's health-check results, so without
    // this the relay is added but stays invisible until the next re-check.
    onAdded();
  };

  return (
    <section aria-labelledby="relays-suggested">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 id="relays-suggested" className="text-body font-medium text-text">Suggested relays</h2>
          <p className="text-text-muted text-caption mt-0.5">{why}</p>
        </div>
        <Button onClick={() => void handleDiscover()} disabled={follows.length === 0} busy={loading}>{loading ? "Discovering…" : "Discover relays"}</Button>
      </div>

      {loaded && suggestions.length === 0 && (
        <p className="text-text-muted text-caption">No new suggestions.</p>
      )}

      <div className="space-y-1">
        {suggestions.map((s) => (
          <div key={s.url} className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg">
            <RelayName url={s.url} />
            <span className="text-text-muted text-caption shrink-0">
              {s.count} follow{s.count !== 1 ? "s" : ""}
            </span>
            <Button size="sm" onClick={() => handleAdd(s.url)}>Add</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
