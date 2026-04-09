import { useV4VStore } from "../../stores/v4v";

const RATE_OPTIONS = [5, 10, 21, 50, 100];

function InfoIcon({ title }: { title: string }) {
  return (
    <span className="text-text-dim cursor-help text-[10px] ml-1" title={title}>
      &#9432;
    </span>
  );
}

export function V4VSettings() {
  const autoEnabled = useV4VStore((s) => s.autoEnabled);
  const perEpisodeCap = useV4VStore((s) => s.perEpisodeCap);
  const weeklyBudget = useV4VStore((s) => s.weeklyBudget);
  const defaultRate = useV4VStore((s) => s.defaultRate);
  const {
    setAutoEnabled, setPerEpisodeCap, setWeeklyBudget, setDefaultRate,
  } = useV4VStore.getState();

  return (
    <div className="max-w-md mx-auto px-6 py-6 space-y-6">
      {/* Auto-enable */}
      <section>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-[12px] text-text font-medium">Auto-stream</span>
            <InfoIcon title="When enabled, V4V streaming starts automatically for every episode that supports it. Requires per-episode cap and weekly budget to be set." />
          </div>
          <button
            onClick={() => setAutoEnabled(!autoEnabled)}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              autoEnabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-bg transition-transform ${
                autoEnabled ? "left-4.5" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-[10px] text-text-dim mt-1">
          Automatically stream sats to creators when playing V4V-enabled episodes.
        </p>
        {autoEnabled && (
          <div className="mt-2 text-[10px] text-success flex items-center gap-1">
            <span>&#9679;</span> Auto-streaming is active
          </div>
        )}
      </section>

      {/* Per-episode cap */}
      <section>
        <div className="flex items-center">
          <label className="text-[12px] text-text font-medium">Per-episode cap</label>
          <InfoIcon title="Maximum sats to stream for a single episode. Streaming stops automatically when this limit is reached." />
        </div>
        <p className="text-[10px] text-text-dim mt-1 mb-2">
          Stop streaming after this many sats per episode.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={perEpisodeCap || ""}
            onChange={(e) => setPerEpisodeCap(parseInt(e.target.value) || 0)}
            placeholder="e.g. 100"
            className="w-24 bg-bg-raised border border-border rounded-sm px-2 py-1 text-[11px] text-text placeholder:text-text-dim/50"
          />
          <span className="text-[10px] text-text-dim">sats</span>
        </div>
      </section>

      {/* Weekly budget */}
      <section>
        <div className="flex items-center">
          <label className="text-[12px] text-text font-medium">Weekly budget</label>
          <InfoIcon title="Total sats allowed across all V4V streaming in a rolling 7-day window. Auto-streaming pauses when the budget is exhausted." />
        </div>
        <p className="text-[10px] text-text-dim mt-1 mb-2">
          Total sats allowed per week across all episodes.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={weeklyBudget || ""}
            onChange={(e) => setWeeklyBudget(parseInt(e.target.value) || 0)}
            placeholder="e.g. 500"
            className="w-24 bg-bg-raised border border-border rounded-sm px-2 py-1 text-[11px] text-text placeholder:text-text-dim/50"
          />
          <span className="text-[10px] text-text-dim">sats / week</span>
        </div>
      </section>

      {/* Default rate */}
      <section>
        <div className="flex items-center">
          <label className="text-[12px] text-text font-medium">Default streaming rate</label>
          <InfoIcon title="How many sats per minute to stream by default. Can be overridden per session in the player bar." />
        </div>
        <p className="text-[10px] text-text-dim mt-1 mb-2">
          Sats per minute when auto-streaming.
        </p>
        <div className="flex items-center gap-1">
          {RATE_OPTIONS.map((rate) => (
            <button
              key={rate}
              onClick={() => setDefaultRate(rate)}
              className={`text-[11px] px-2.5 py-1 rounded-sm transition-colors ${
                defaultRate === rate
                  ? "bg-accent/20 text-accent font-medium"
                  : "text-text-dim hover:text-text bg-bg-raised"
              }`}
            >
              {rate}
            </button>
          ))}
          <span className="text-[10px] text-text-dim ml-1">/min</span>
        </div>
      </section>

      {/* Requirements notice */}
      {!autoEnabled && (perEpisodeCap <= 0 || weeklyBudget <= 0) && (
        <div className="text-[10px] text-text-dim bg-bg-raised border border-border rounded-sm p-3">
          Set both a per-episode cap and weekly budget to enable auto-streaming.
        </div>
      )}
    </div>
  );
}
