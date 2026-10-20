import { useUIStore } from "../../stores/ui";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { nameOf } from "../../lib/utils";
import { AvatarInitial } from "../shared/AvatarInitial";
import { FollowButton } from "../shared/FollowButton";

/** A person as a row: avatar, name, NIP-05, "follows you", "new", and the follow button. Shared by People and the Followers tab of Notifications. */
export function FollowRow({
  pubkey,
  followsYou,
  isNew,
}: {
  pubkey: string;
  followsYou?: boolean;
  isNew?: boolean;
}) {
  const profile = useProfile(pubkey);
  const name = nameOf(profile, pubkey);
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const nip05 = typeof profile?.nip05 === "string" ? profile.nip05 : undefined;
  const verified = useNip05Verified(pubkey, nip05);

  const { openProfile } = useUIStore();

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <button className="shrink-0" aria-label={`View profile of ${name}`} onClick={() => openProfile(pubkey)}>
        {avatar ? (
          <img
            src={avatar}
            alt={`${name}'s avatar`}
            className="w-9 h-9 rounded-full object-cover bg-bg-raised hover:opacity-80 transition-opacity"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
            <AvatarInitial profile={profile} />
          </div>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => openProfile(pubkey)}
            className="text-text font-medium truncate text-body hover:text-accent transition-colors text-left"
          >
            {name}
          </button>
          {nip05 && (
            <span className={`text-caption truncate max-w-40 ${verified === "valid" ? "text-success" : "text-text-dim"}`}>
              {verified === "valid" ? "✓ " : ""}{nip05}
            </span>
          )}
          {followsYou && (
            <span className="text-micro text-text-dim bg-bg-raised px-1.5 py-0.5 rounded-sm">follows you</span>
          )}
          {isNew && (
            <span className="text-micro text-accent bg-accent/15 px-1.5 py-0.5 rounded-sm font-medium">new</span>
          )}
        </div>
      </div>

      <FollowButton pubkey={pubkey} />
    </div>
  );
}
