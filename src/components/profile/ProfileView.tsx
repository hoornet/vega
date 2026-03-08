import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useProfile } from "../../hooks/useProfile";
import { fetchUserNotes } from "../../lib/nostr";
import { shortenPubkey } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";

export function ProfileView() {
  const { selectedPubkey, goBack } = useUIStore();
  const pubkey = selectedPubkey!;
  const profile = useProfile(pubkey);

  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const name = profile?.displayName || profile?.name || shortenPubkey(pubkey);
  const avatar = profile?.picture;
  const about = profile?.about;
  const nip05 = profile?.nip05;
  const website = profile?.website;

  useEffect(() => {
    setLoading(true);
    fetchUserNotes(pubkey).then((events) => {
      setNotes(events);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pubkey]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex items-center gap-3 shrink-0">
        <button
          onClick={goBack}
          className="text-text-dim hover:text-text text-[11px] transition-colors"
        >
          ← back
        </button>
        <h1 className="text-text text-sm font-medium">Profile</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Profile card */}
        <div className="border-b border-border px-4 py-4">
          <div className="flex gap-4 items-start">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                className="w-14 h-14 rounded-sm object-cover bg-bg-raised shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-14 h-14 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-lg shrink-0">
                {name.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="text-text font-medium text-[15px]">{name}</div>
              {nip05 && (
                <div className="text-text-dim text-[11px] mt-0.5">{nip05}</div>
              )}
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent text-[11px] hover:text-accent-hover mt-0.5 block"
                >
                  {website.replace(/^https?:\/\//, "")}
                </a>
              )}
              {about && (
                <p className="text-text text-[12px] mt-2 leading-relaxed whitespace-pre-wrap">
                  {about}
                </p>
              )}
              <div className="text-text-dim text-[10px] font-mono mt-2">
                {shortenPubkey(pubkey)}
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {loading && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            Loading notes…
          </div>
        )}

        {!loading && notes.length === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            No notes found.
          </div>
        )}

        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
