import { useEffect, useRef, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useProfile, invalidateProfileCache } from "../../hooks/useProfile";
import { fetchUserNotes, publishProfile } from "../../lib/nostr";
import { shortenPubkey } from "../../lib/utils";
import { uploadImage } from "../../lib/upload";
import { NoteCard } from "../feed/NoteCard";
import { ZapModal } from "../zap/ZapModal";

// ── Profile helper sub-components ────────────────────────────────────────────

function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await uploadImage(file);
      onChange(url);
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="text-text-dim text-[10px] block mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…  or click upload →"
          className="flex-1 bg-bg border border-border px-3 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1.5 text-[10px] border border-border text-text-dim hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="Upload from your computer"
        >
          {uploading ? "uploading…" : "upload"}
        </button>
      </div>
      {uploadError && <p className="text-danger text-[10px] mt-1">{uploadError}</p>}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}

type Nip05Status = "idle" | "checking" | "valid" | "mismatch" | "notfound";

function Nip05Field({ value, onChange, pubkey }: { value: string; onChange: (v: string) => void; pubkey: string }) {
  const [status, setStatus] = useState<Nip05Status>("idle");

  useEffect(() => {
    if (!value.includes("@")) { setStatus("idle"); return; }
    setStatus("checking");
    const t = setTimeout(async () => {
      const [name, domain] = value.trim().split("@");
      if (!name || !domain) { setStatus("notfound"); return; }
      try {
        const resp = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
        const data = await resp.json();
        const resolved = data.names?.[name];
        if (!resolved) setStatus("notfound");
        else if (resolved === pubkey) setStatus("valid");
        else setStatus("mismatch");
      } catch {
        setStatus("notfound");
      }
    }, 900);
    return () => clearTimeout(t);
  }, [value, pubkey]);

  const badge = {
    idle: null,
    checking: <span className="text-text-dim text-[10px]">checking…</span>,
    valid: <span className="text-success text-[10px]">✓ verified</span>,
    mismatch: <span className="text-danger text-[10px]">✗ pubkey mismatch</span>,
    notfound: <span className="text-danger text-[10px]">✗ not found</span>,
  }[status];

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <label className="text-text-dim text-[10px]">NIP-05 verified name</label>
        {badge}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@domain.com"
        className="w-full bg-bg border border-border px-3 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />
      <p className="text-text-dim text-[10px] mt-1">
        Proves your identity via a domain you control.{" "}
        <a
          href="https://nostr.how/en/guides/get-verified"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-hover transition-colors"
        >
          How to get verified ↗
        </a>
      </p>
    </div>
  );
}

function EditProfileForm({ pubkey, onSaved }: { pubkey: string; onSaved: () => void }) {
  const { profile, fetchOwnProfile } = useUserStore();
  const [name, setName] = useState(profile?.name || "");
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [about, setAbout] = useState(profile?.about || "");
  const [picture, setPicture] = useState(profile?.picture || "");
  const [banner, setBanner] = useState(profile?.banner || "");
  const [website, setWebsite] = useState(profile?.website || "");
  const [nip05, setNip05] = useState(profile?.nip05 || "");
  const [lud16, setLud16] = useState(profile?.lud16 || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      invalidateProfileCache(pubkey);
      await publishProfile({
        name: name.trim() || undefined,
        display_name: displayName.trim() || undefined,
        about: about.trim() || undefined,
        picture: picture.trim() || undefined,
        banner: banner.trim() || undefined,
        website: website.trim() || undefined,
        nip05: nip05.trim() || undefined,
        lud16: lud16.trim() || undefined,
      });
      await fetchOwnProfile();
      setSaved(true);
      setTimeout(onSaved, 1000);
    } catch (err) {
      setError(`Failed to save: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = "") => (
    <div>
      <label className="text-text-dim text-[10px] block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-bg border border-border px-3 py-1.5 text-text text-[12px] focus:outline-none focus:border-accent/50"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />
    </div>
  );

  return (
    <div className="px-4 py-4 border-b border-border">
      <div className="grid grid-cols-2 gap-3 mb-3">
        {field("Display name", displayName, setDisplayName, "Square that Circle")}
        {field("Username", name, setName, "squarethecircle")}
        <Nip05Field value={nip05} onChange={setNip05} pubkey={pubkey} />
        {field("Lightning address (lud16)", lud16, setLud16, "you@walletofsatoshi.com")}
        {field("Website", website, setWebsite, "https://…")}
        <ImageField label="Profile picture" value={picture} onChange={setPicture} />
      </div>
      <div className="mb-3">
        <label className="text-text-dim text-[10px] block mb-1">Bio</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Tell people about yourself…"
          rows={3}
          className="w-full bg-bg border border-border px-3 py-1.5 text-text text-[12px] resize-none focus:outline-none focus:border-accent/50"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
      </div>
      <div className="mb-3">
        <ImageField label="Banner image" value={banner} onChange={setBanner} />
      </div>
      {error && <p className="text-danger text-[11px] mb-2">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className="px-4 py-1.5 text-[11px] bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saved ? "saved ✓" : saving ? "saving…" : "save profile"}
        </button>
      </div>
    </div>
  );
}

export function ProfileView() {
  const { selectedPubkey, goBack, openDM } = useUIStore();
  const { pubkey: ownPubkey, profile: ownProfile, loggedIn, follows, follow, unfollow } = useUserStore();
  const pubkey = selectedPubkey!;
  const isOwn = pubkey === ownPubkey;

  // For own profile, use the user store directly — it's updated immediately
  // after save. useProfile() only re-fetches when pubkey changes, so it would
  // show stale data until the user navigates away and back.
  const fetchedProfile = useProfile(pubkey);
  const profile = isOwn ? ownProfile : fetchedProfile;
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [showZap, setShowZap] = useState(false);

  const isFollowing = follows.includes(pubkey);
  const { mutedPubkeys, mute, unmute } = useMuteStore();
  const isMuted = mutedPubkeys.includes(pubkey);

  const handleFollowToggle = async () => {
    setFollowPending(true);
    try {
      if (isFollowing) {
        await unfollow(pubkey);
      } else {
        await follow(pubkey);
      }
    } finally {
      setFollowPending(false);
    }
  };

  const name = profile?.displayName || profile?.name || shortenPubkey(pubkey);
  const avatar = profile?.picture;
  const about = profile?.about;
  const nip05 = profile?.nip05;
  const website = profile?.website;
  const lud16 = profile?.lud16;

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
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={editing ? () => setEditing(false) : goBack}
            className="text-text-dim hover:text-text text-[11px] transition-colors"
          >
            ← {editing ? "cancel" : "back"}
          </button>
          <h1 className="text-text text-sm font-medium">{isOwn ? "Your Profile" : "Profile"}</h1>
        </div>
        {isOwn && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
          >
            edit profile
          </button>
        )}
        {!isOwn && loggedIn && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowZap(true)}
              className="text-[11px] px-3 py-1 border border-border text-zap hover:border-zap/40 hover:bg-zap/5 transition-colors"
            >
              ⚡ zap
            </button>
            <button
              onClick={handleFollowToggle}
              disabled={followPending}
              className={`text-[11px] px-3 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isFollowing
                  ? "border-border text-text-muted hover:text-danger hover:border-danger/40"
                  : "border-accent/60 text-accent hover:bg-accent hover:text-white"
              }`}
            >
              {followPending ? "…" : isFollowing ? "unfollow" : "follow"}
            </button>
            <button
              onClick={() => isMuted ? unmute(pubkey) : mute(pubkey)}
              className={`text-[11px] px-3 py-1 border transition-colors ${
                isMuted
                  ? "border-danger/40 text-danger hover:bg-danger/5"
                  : "border-border text-text-dim hover:text-danger hover:border-danger/40"
              }`}
            >
              {isMuted ? "unmute" : "mute"}
            </button>
            <button
              onClick={() => openDM(pubkey)}
              className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
            >
              ✉ message
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Edit form */}
        {editing && (
          <EditProfileForm pubkey={pubkey} onSaved={() => setEditing(false)} />
        )}

        {/* Profile card */}
        {!editing && (
          <div className="border-b border-border">
            {/* Banner */}
            {profile?.banner && (
              <div className="h-24 bg-bg-raised overflow-hidden">
                <img src={profile.banner} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}

            <div className="px-4 py-4 flex gap-4 items-start">
              {avatar ? (
                <img src={avatar} alt="" className="w-14 h-14 rounded-sm object-cover bg-bg-raised shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-14 h-14 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-lg shrink-0">
                  {name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="text-text font-medium text-[15px]">{name}</div>
                {nip05 && <div className="text-text-dim text-[11px] mt-0.5">{nip05}</div>}
                {lud16 && <div className="text-zap text-[11px] mt-0.5">⚡ {lud16}</div>}
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="text-accent text-[11px] hover:text-accent-hover mt-0.5 block">
                    {website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {about && <p className="text-text text-[12px] mt-2 leading-relaxed whitespace-pre-wrap">{about}</p>}
                {isOwn && !about && (
                  <p className="text-text-dim text-[12px] mt-2 italic">No bio yet — click "edit profile" to add one.</p>
                )}
                <div className="text-text-dim text-[10px] font-mono mt-2">{shortenPubkey(pubkey)}</div>
              </div>
            </div>
          </div>
        )}

        {showZap && (
          <ZapModal
            target={{ type: "profile", pubkey }}
            recipientName={name}
            onClose={() => setShowZap(false)}
          />
        )}

        {/* Notes */}
        {loading && <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading notes…</div>}
        {!loading && notes.length === 0 && <div className="px-4 py-8 text-text-dim text-[12px] text-center">No notes found.</div>}
        {notes.map((event) => (
          <NoteCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
