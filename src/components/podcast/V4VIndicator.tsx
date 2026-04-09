import { useState, useCallback, useEffect, useRef } from "react";
import { usePodcastStore } from "../../stores/podcast";
import { useV4VStore } from "../../stores/v4v";
import { useUIStore } from "../../stores/ui";
import { startStreaming, stopStreaming, boost } from "../../lib/podcast/v4v";

const NWC_KEY = "wrystr_nwc_uri";

// Track which episodes have shown the nudge this session (not persisted)
const nudgedGuids = new Set<string>();

export function V4VIndicator() {
  const [open, setOpen] = useState(false);
  const [boostAmount, setBoostAmount] = useState("100");
  const [boosting, setBoosting] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const episode = usePodcastStore((s) => s.currentEpisode);
  const v4vSatsPerMinute = usePodcastStore((s) => s.v4vSatsPerMinute);
  const v4vStreaming = usePodcastStore((s) => s.v4vStreaming);
  const v4vTotalStreamed = usePodcastStore((s) => s.v4vTotalStreamed);
  const playbackState = usePodcastStore((s) => s.playbackState);
  const { setV4VEnabled, setV4VStreaming, addStreamedSats } = usePodcastStore.getState();

  const autoEnabled = useV4VStore((s) => s.autoEnabled);
  const defaultRate = useV4VStore((s) => s.defaultRate);
  const capReachedReason = useV4VStore((s) => s.capReachedReason);

  const nwcUri = localStorage.getItem(NWC_KEY) ?? "";
  const hasWallet = !!nwcUri;
  const hasRecipients = episode?.value && episode.value.length > 0;

  // Auto-start streaming when autoEnabled and V4V episode starts playing
  useEffect(() => {
    if (
      autoEnabled &&
      playbackState === "playing" &&
      hasRecipients &&
      hasWallet &&
      !v4vStreaming &&
      episode
    ) {
      const intervalId = startStreaming(
        episode,
        defaultRate,
        nwcUri,
        (amount) => addStreamedSats(amount),
      );
      if (intervalId >= 0) {
        setV4VStreaming(true, intervalId);
        setV4VEnabled(true);
      }
    }
  }, [playbackState, episode?.guid, autoEnabled]);

  // Show nudge when a V4V episode starts playing and streaming is off (manual mode)
  useEffect(() => {
    if (
      playbackState === "playing" &&
      episode?.value &&
      episode.value.length > 0 &&
      !v4vStreaming &&
      !autoEnabled &&
      !nudgedGuids.has(episode.guid)
    ) {
      nudgedGuids.add(episode.guid);
      setShowNudge(true);
      nudgeTimer.current = setTimeout(() => setShowNudge(false), 5000);
    }
    return () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    };
  }, [playbackState, episode?.guid, v4vStreaming, autoEnabled]);

  const toggleStreaming = useCallback(() => {
    if (!episode || !hasWallet) return;

    if (v4vStreaming) {
      stopStreaming();
      setV4VStreaming(false);
      setV4VEnabled(false);
    } else {
      const rate = autoEnabled ? defaultRate : v4vSatsPerMinute;
      const intervalId = startStreaming(
        episode,
        rate,
        nwcUri,
        (amount) => addStreamedSats(amount),
      );
      if (intervalId >= 0) {
        setV4VStreaming(true, intervalId);
        setV4VEnabled(true);
      }
    }
  }, [episode, v4vStreaming, v4vSatsPerMinute, defaultRate, autoEnabled, nwcUri, hasWallet]);

  const handleBoost = useCallback(async () => {
    if (!episode || !hasWallet || boosting) return;
    const amount = parseInt(boostAmount);
    if (!amount || amount <= 0) return;

    setBoosting(true);
    const paid = await boost(episode, amount, nwcUri);
    if (paid > 0) addStreamedSats(paid);
    setBoosting(false);
  }, [episode, boostAmount, nwcUri, hasWallet, boosting]);

  if (!episode) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => { setOpen(!open); setShowNudge(false); }}
        className={`text-[11px] px-1.5 py-0.5 rounded-sm transition-colors flex items-center gap-1 ${
          capReachedReason
            ? "text-text-dim bg-border/50"
            : v4vStreaming
              ? "text-amber-400 bg-amber-500/10 animate-pulse"
              : hasRecipients
                ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                : "text-text-dim hover:text-text"
        }`}
        title="Value 4 Value"
      >
        {v4vStreaming && autoEnabled && (
          <span className="text-[8px] text-accent bg-accent/15 px-1 rounded-sm font-medium">AUTO</span>
        )}
        {capReachedReason
          ? `⚡ ${v4vTotalStreamed} sats (capped)`
          : v4vStreaming
            ? `⚡ ${v4vTotalStreamed} sats`
            : hasRecipients ? "⚡ V4V" : "V4V"
        }
      </button>

      {/* Brief nudge when V4V episode starts — once per episode per session */}
      {showNudge && (
        <div
          className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-warning/15 border border-warning/30 rounded-sm text-[10px] text-warning whitespace-nowrap z-50 animate-fade-in cursor-pointer"
          onClick={() => { setShowNudge(false); setOpen(true); }}
        >
          ⚡ This episode supports V4V — stream sats to the creators
        </div>
      )}

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-56 bg-bg border border-border rounded-sm shadow-lg p-3 z-50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] text-text font-medium">Value 4 Value</div>
            <button
              onClick={() => { setOpen(false); useUIStore.getState().setView("v4v"); }}
              className="text-[9px] text-accent hover:text-accent-hover transition-colors"
            >
              open v4v ↗
            </button>
          </div>

          {!hasWallet && (
            <div className="text-[10px] text-text-dim mb-2">
              Connect NWC wallet in Settings to stream sats.
            </div>
          )}

          {!hasRecipients && hasWallet && (
            <div className="text-[10px] text-text-dim mb-2">
              This episode has no V4V recipients.
            </div>
          )}

          {hasWallet && hasRecipients && (
            <>
              {/* Toggle */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-text-muted">Stream sats</span>
                <button
                  onClick={toggleStreaming}
                  className={`w-8 h-4 rounded-full transition-colors relative ${
                    v4vStreaming ? "bg-accent" : "bg-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-bg transition-transform ${
                      v4vStreaming ? "left-4" : "left-0.5"
                    }`}
                  />
                </button>
              </div>

              {/* Recipients */}
              {episode.value && episode.value.length > 0 && (
                <div className="mb-2 border-t border-border pt-2">
                  <div className="text-[9px] text-text-dim mb-1">Sats go to:</div>
                  {episode.value.map((r, i) => {
                    const totalSplit = episode.value!.reduce((s, v) => s + v.split, 0);
                    const pct = totalSplit > 0 ? Math.round((r.split / totalSplit) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center justify-between text-[9px]">
                        <span className="text-text-muted truncate">{r.name || r.address?.slice(0, 12) + "…"}</span>
                        <span className="text-text-dim shrink-0 ml-1">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Boost */}
              <div className="flex items-center gap-1 border-t border-border pt-2">
                <input
                  type="number"
                  value={boostAmount}
                  onChange={(e) => setBoostAmount(e.target.value)}
                  className="w-16 bg-bg-raised border border-border rounded-sm px-1.5 py-0.5 text-[10px] text-text"
                  min="1"
                />
                <button
                  onClick={handleBoost}
                  disabled={boosting}
                  className="text-[10px] text-accent hover:text-accent-hover px-2 py-0.5 bg-accent/10 rounded-sm disabled:opacity-40"
                >
                  {boosting ? "…" : "boost"}
                </button>
              </div>

              {v4vTotalStreamed > 0 && (
                <div className="text-[9px] text-text-dim mt-2">
                  Total streamed: {v4vTotalStreamed} sats
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
