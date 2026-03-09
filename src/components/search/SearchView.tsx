import { useState, useRef } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { searchNotes, searchUsers } from "../../lib/nostr";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { shortenPubkey } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";

interface ParsedUser {
  pubkey: string;
  name: string;
  displayName: string;
  picture: string;
  nip05: string;
  about: string;
}

function parseUserEvent(event: NDKEvent): ParsedUser {
  let meta: Record<string, string> = {};
  try { meta = JSON.parse(event.content); } catch { /* ignore */ }
  return {
    pubkey: event.pubkey,
    name: meta.name || "",
    displayName: meta.display_name || meta.name || "",
    picture: meta.picture || "",
    nip05: meta.nip05 || "",
    about: meta.about || "",
  };
}

function UserRow({ user }: { user: ParsedUser }) {
  const { loggedIn, pubkey: myPubkey, follows, follow, unfollow } = useUserStore();
  const { openProfile: navToProfile } = useUIStore();
  const isOwn = user.pubkey === myPubkey;
  const isFollowing = follows.includes(user.pubkey);
  const [pending, setPending] = useState(false);
  const displayName = user.displayName || user.name || shortenPubkey(user.pubkey);

  const handleFollowToggle = async () => {
    setPending(true);
    try {
      if (isFollowing) await unfollow(user.pubkey);
      else await follow(user.pubkey);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border hover:bg-bg-hover transition-colors">
      <div
        className="shrink-0 cursor-pointer"
        onClick={() => navToProfile(user.pubkey)}
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="w-9 h-9 rounded-sm object-cover bg-bg-raised"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navToProfile(user.pubkey)}>
        <div className="text-text text-[13px] font-medium truncate">{displayName}</div>
        {user.nip05 && <div className="text-text-dim text-[10px] truncate">{user.nip05}</div>}
        {user.about && <div className="text-text-dim text-[11px] truncate mt-0.5">{user.about}</div>}
      </div>
      {loggedIn && !isOwn && (
        <button
          onClick={handleFollowToggle}
          disabled={pending}
          className={`text-[11px] px-3 py-1 border transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
            isFollowing
              ? "border-border text-text-muted hover:text-danger hover:border-danger/40"
              : "border-accent/60 text-accent hover:bg-accent hover:text-white"
          }`}
        >
          {pending ? "…" : isFollowing ? "unfollow" : "follow"}
        </button>
      )}
    </div>
  );
}

export function SearchView() {
  const [query, setQuery] = useState("");
  const [noteResults, setNoteResults] = useState<NDKEvent[]>([]);
  const [userResults, setUserResults] = useState<ParsedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<"notes" | "people">("notes");
  const inputRef = useRef<HTMLInputElement>(null);

  const isHashtag = query.trim().startsWith("#");

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(false);
    try {
      const notesPromise = searchNotes(q);
      const usersPromise = isHashtag ? Promise.resolve([]) : searchUsers(q);
      const [notes, userEvents] = await Promise.all([notesPromise, usersPromise]);
      setNoteResults(notes);
      setUserResults(userEvents.map(parseUserEvent));
      setActiveTab(notes.length > 0 ? "notes" : "people");
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const totalResults = noteResults.length + userResults.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="search notes, #hashtags, or people…"
            autoFocus
            className="flex-1 bg-transparent text-text text-[13px] placeholder:text-text-dim focus:outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {loading ? "…" : "search"}
          </button>
        </div>
      </header>

      {/* Tabs (only when we have both note and people results) */}
      {searched && !isHashtag && noteResults.length > 0 && userResults.length > 0 && (
        <div className="border-b border-border flex shrink-0">
          {(["notes", "people"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-[11px] border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-accent text-accent"
                  : "border-transparent text-text-dim hover:text-text"
              }`}
            >
              {tab === "notes" ? `notes (${noteResults.length})` : `people (${userResults.length})`}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty / idle state */}
        {!searched && !loading && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            <p>Search notes with NIP-50 full-text, or use <span className="text-accent">#hashtag</span> to browse topics.</p>
            <p className="mt-1 text-[11px] opacity-60">NIP-50 requires relay support — results vary by relay.</p>
          </div>
        )}

        {searched && totalResults === 0 && (
          <div className="px-4 py-8 text-text-dim text-[12px] text-center">
            No results for <span className="text-text">{query}</span>.
            {!isHashtag && <p className="mt-1 text-[11px] opacity-60">Your relays may not support NIP-50 full-text search.</p>}
          </div>
        )}

        {/* People tab */}
        {activeTab === "people" && userResults.map((user) => (
          <UserRow key={user.pubkey} user={user} />
        ))}

        {/* Notes tab (or all notes for hashtag search) */}
        {(activeTab === "notes" || isHashtag) && noteResults.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}

        {/* People inline when only people results */}
        {searched && noteResults.length === 0 && userResults.length > 0 && activeTab === "notes" && (
          userResults.map((user) => <UserRow key={user.pubkey} user={user} />)
        )}
      </div>
    </div>
  );
}
