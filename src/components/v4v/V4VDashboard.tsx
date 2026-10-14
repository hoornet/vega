import { usePodcastStore } from "../../stores/podcast";
import { useV4VStore } from "../../stores/v4v";

function BudgetBar({ label, spent, total }: { label: string; spent: number; total: number }) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((spent / total) * 100));
  const isNear = pct >= 80;
  const isOver = pct >= 100;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between text-caption mb-1">
        <span className="text-text-muted">{label}</span>
        <span className={`font-medium ${isOver ? "text-danger" : isNear ? "text-warning" : "text-text"}`}>
          {spent} / {total} sats
        </span>
      </div>
      <div className="h-2 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isOver ? "bg-danger" : isNear ? "bg-warning" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-micro text-text-dim mt-0.5 text-right">
        {total - spent > 0 ? `${total - spent} sats remaining` : "Budget reached"}
      </div>
    </div>
  );
}

export function V4VDashboard() {
  const episode = usePodcastStore((s) => s.currentEpisode);
  const v4vStreaming = usePodcastStore((s) => s.v4vStreaming);
  const v4vTotalStreamed = usePodcastStore((s) => s.v4vTotalStreamed);

  const autoEnabled = useV4VStore((s) => s.autoEnabled);
  const perEpisodeCap = useV4VStore((s) => s.perEpisodeCap);
  const weeklyBudget = useV4VStore((s) => s.weeklyBudget);
  const defaultRate = useV4VStore((s) => s.defaultRate);
  const currentEpisodeSats = useV4VStore((s) => s.currentEpisodeSats);
  const unconfirmedSats = useV4VStore((s) => s.unconfirmedSats);
  const lastFailure = useV4VStore((s) => s.lastFailure);
  const capReachedReason = useV4VStore((s) => s.capReachedReason);
  const history = useV4VStore((s) => s.history);
  const weeklySpent = useV4VStore((s) => s.weeklySpent)();

  const hasRecipients = episode?.value && episode.value.length > 0;

  // All-time stats
  const allTimeSats = history.reduce((sum, e) => sum + e.satsStreamed + e.satsBoosted, 0) + v4vTotalStreamed;
  const episodesSupported = new Set(history.map((e) => e.episodeGuid)).size;

  return (
    <div className="max-w-md mx-auto px-6 py-6">
      {/* Current streaming status */}
      <section className="mb-6">
        <h2 className="text-text-dim text-micro uppercase tracking-widest mb-3">Now</h2>

        {!episode ? (
          <div className="text-body text-text-dim">No episode playing.</div>
        ) : !hasRecipients ? (
          <div className="text-body text-text-dim">
            Playing <span className="text-text">{episode.title}</span> — no V4V recipients.
          </div>
        ) : v4vStreaming ? (
          <div className="bg-zap/5 border border-zap/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-zap animate-pulse">&#9889;</span>
              <span className="text-body text-text font-medium">Streaming</span>
              {autoEnabled && (
                <span className="text-micro text-accent bg-accent/10 px-1.5 py-0.5 rounded-sm">AUTO</span>
              )}
            </div>
            <div className="text-caption text-text-muted truncate">{episode.title}</div>
            <div className="text-caption text-text-dim mt-1">
              {v4vTotalStreamed} sats this session · {episode.value?.length} recipients
            </div>
          </div>
        ) : capReachedReason ? (
          <div className="bg-danger/5 border border-danger/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-danger">&#9889;</span>
              <span className="text-body text-text font-medium">{capReachedReason}</span>
            </div>
            <div className="text-caption text-text-muted truncate">{episode.title}</div>
            <div className="text-caption text-text-dim mt-1">
              {currentEpisodeSats} sats streamed to {episode.value?.length} recipients
              {unconfirmedSats > 0 && <span className="text-text-dim"> ({unconfirmedSats} sent, not yet confirmed by your wallet)</span>}
            </div>
            {lastFailure && (
              <p role="status" className="text-danger text-caption mt-1">Couldn't pay {lastFailure.recipient}: {lastFailure.reason}.</p>
            )}
          </div>
        ) : (
          <div className="text-body text-text-dim">
            Playing <span className="text-text">{episode.title}</span> — V4V available but not streaming.
          </div>
        )}
      </section>

      {/* Budget bars */}
      {(perEpisodeCap > 0 || weeklyBudget > 0) && (
        <section className="mb-6">
          <h2 className="text-text-dim text-micro uppercase tracking-widest mb-3">Budget</h2>
          <BudgetBar label="This episode" spent={currentEpisodeSats} total={perEpisodeCap} />
          <BudgetBar label="This week" spent={weeklySpent} total={weeklyBudget} />
        </section>
      )}

      {/* Quick stats */}
      <section>
        <h2 className="text-text-dim text-micro uppercase tracking-widest mb-3">Stats</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-bg-raised border border-border rounded-lg p-3 text-center">
            <div className="text-title text-text font-medium">{allTimeSats}</div>
            <div className="text-micro text-text-dim mt-0.5">total sats</div>
          </div>
          <div className="bg-bg-raised border border-border rounded-lg p-3 text-center">
            <div className="text-title text-text font-medium">{episodesSupported}</div>
            <div className="text-micro text-text-dim mt-0.5">episodes</div>
          </div>
          <div className="bg-bg-raised border border-border rounded-lg p-3 text-center">
            <div className="text-title text-text font-medium">
              {autoEnabled ? `${defaultRate}/m` : "off"}
            </div>
            <div className="text-micro text-text-dim mt-0.5">auto-stream</div>
          </div>
        </div>
      </section>
    </div>
  );
}
