import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useUIStore } from "../../stores/ui";
import { shortenPubkey, timeAgo, profileName } from "../../lib/utils";

function AncestorCard({ event }: { event: NDKEvent }) {
  const profile = useProfile(event.pubkey);
  const name = profileName(profile, shortenPubkey(event.pubkey));
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const time = event.created_at ? timeAgo(event.created_at) : "";
  const { openThread } = useUIStore();

  const truncated = event.content.length > 120
    ? event.content.slice(0, 120) + "..."
    : event.content;

  return (
    <button
      onClick={() => openThread(event)}
      className="w-full text-left px-4 py-2 border-b border-border hover:bg-bg-hover transition-colors flex gap-2.5 items-start"
    >
      <div className="shrink-0 mt-0.5">
        {avatar ? (
          <img src={avatar} alt="" className="w-6 h-6 rounded-sm object-cover bg-bg-raised" loading="lazy" />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-[9px]">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-text font-medium text-[11px] truncate">{name}</span>
          <span className="text-text-dim text-[10px] shrink-0">{time}</span>
        </div>
        <div className="text-text-dim text-[11px] line-clamp-2 break-words">{truncated}</div>
      </div>
      <div className="text-text-dim text-[10px] shrink-0 mt-0.5">↑</div>
    </button>
  );
}

interface AncestorChainProps {
  ancestors: NDKEvent[];
}

export function AncestorChain({ ancestors }: AncestorChainProps) {
  if (ancestors.length === 0) return null;

  return (
    <div className="bg-bg-raised/50">
      <div className="px-4 py-1.5 text-text-dim text-[10px] border-b border-border">
        {ancestors.length} parent {ancestors.length === 1 ? "note" : "notes"} above
      </div>
      {ancestors.map((a) => (
        <AncestorCard key={a.id} event={a} />
      ))}
    </div>
  );
}
