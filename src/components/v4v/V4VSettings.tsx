import { useId } from "react";
import { useV4VStore } from "../../stores/v4v";
import { SwitchControl } from "../shared/Switch";

const RATE_OPTIONS = [5, 10, 21, 50, 100];

export function V4VSettings() {
  const autoId = useId();
  const autoEnabled = useV4VStore((s) => s.autoEnabled);
  const perEpisodeCap = useV4VStore((s) => s.perEpisodeCap);
  const weeklyBudget = useV4VStore((s) => s.weeklyBudget);
  const defaultRate = useV4VStore((s) => s.defaultRate);
  const {
    setAutoEnabled, setPerEpisodeCap, setWeeklyBudget, setDefaultRate,
  } = useV4VStore.getState();
  const limitsSet = perEpisodeCap > 0 && weeklyBudget > 0;

  return (
    <div className="max-w-md mx-auto px-6 py-6 space-y-6">
      {/* Auto-enable. Disabled, with the reason as its hint, until both limits are set: the store refuses
          otherwise, and a switch that looks live and only raises a toast is a switch that does not work. */}
      <section>
        <div className="flex items-center justify-between">
          <label id={`${autoId}-label`} htmlFor={autoId} className={`text-body font-medium ${limitsSet ? "text-text cursor-pointer" : "text-text-muted cursor-not-allowed"}`}>Auto-stream</label>
          <SwitchControl id={autoId} checked={autoEnabled} onChange={setAutoEnabled} disabled={!limitsSet} aria-labelledby={`${autoId}-label`} aria-describedby={`${autoId}-hint`} />
        </div>
        <p id={`${autoId}-hint`} className="text-caption text-text-muted mt-1">
          {limitsSet
            ? "Streams sats to the makers of every episode that supports it, as soon as it plays, at the rate below and within the limits."
            : "Set a per-episode cap and a weekly budget first. Then every episode that supports it is paid as it plays."}
        </p>
      </section>

      {/* Per-episode cap */}
      <section>
        <label htmlFor={`${autoId}-cap`} className="text-body text-text font-medium">Per-episode cap</label>
        <p className="text-caption text-text-muted mt-1 mb-2">
          Streaming stops once this many sats have gone to one episode.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            id={`${autoId}-cap`}
            value={perEpisodeCap || ""}
            onChange={(e) => setPerEpisodeCap(parseInt(e.target.value) || 0)}
            placeholder="e.g. 100"
            className="w-24 bg-bg-raised border border-border-strong rounded-lg px-2 py-1 text-ui text-text placeholder:text-text-dim"
          />
          <span className="text-caption text-text-dim">sats</span>
        </div>
      </section>

      {/* Weekly budget */}
      <section>
        <label htmlFor={`${autoId}-week`} className="text-body text-text font-medium">Weekly budget</label>
        <p className="text-caption text-text-muted mt-1 mb-2">
          Total sats across all episodes in a rolling seven days. Streaming pauses when it is spent.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            id={`${autoId}-week`}
            value={weeklyBudget || ""}
            onChange={(e) => setWeeklyBudget(parseInt(e.target.value) || 0)}
            placeholder="e.g. 500"
            className="w-24 bg-bg-raised border border-border-strong rounded-lg px-2 py-1 text-ui text-text placeholder:text-text-dim"
          />
          <span className="text-caption text-text-dim">sats / week</span>
        </div>
      </section>

      {/* Default rate */}
      <section>
        <label className="text-body text-text font-medium">Streaming rate</label>
        <p className="text-caption text-text-muted mt-1 mb-2">
          Sats per minute, unless changed for one episode in the player bar.
        </p>
        <div className="flex items-center gap-1">
          {RATE_OPTIONS.map((rate) => (
            <button
              key={rate}
              onClick={() => setDefaultRate(rate)}
              className={`text-ui px-2.5 py-1 rounded-sm transition-colors ${
                defaultRate === rate
                  ? "bg-accent/20 text-accent font-medium"
                  : "text-text-dim hover:text-text bg-bg-raised"
              }`}
            >
              {rate}
            </button>
          ))}
          <span className="text-caption text-text-dim ml-1">/min</span>
        </div>
      </section>

    </div>
  );
}
