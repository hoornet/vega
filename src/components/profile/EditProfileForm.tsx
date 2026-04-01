import { useState } from "react";
import { useUserStore } from "../../stores/user";
import { invalidateProfileCache } from "../../hooks/useProfile";
import { publishProfile } from "../../lib/nostr";
import { ImageField } from "./ImageField";
import { Nip05Field } from "./Nip05Field";

export function EditProfileForm({ pubkey, onSaved }: { pubkey: string; onSaved: () => void }) {
  const { profile, fetchOwnProfile } = useUserStore();
  const safeStr = (v: unknown) => (typeof v === "string" ? v : "");
  const [name, setName] = useState(safeStr(profile?.name));
  const [displayName, setDisplayName] = useState(safeStr(profile?.displayName));
  const [about, setAbout] = useState(safeStr(profile?.about));
  const [picture, setPicture] = useState(safeStr(profile?.picture));
  const [banner, setBanner] = useState(safeStr(profile?.banner));
  const [website, setWebsite] = useState(safeStr(profile?.website));
  const [nip05, setNip05] = useState(safeStr(profile?.nip05));
  const [lud16, setLud16] = useState(safeStr(profile?.lud16));
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
