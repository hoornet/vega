import { useState, useRef } from "react";
import { uploadImage } from "../../lib/upload";
import { Button } from "../shared/Button";

export function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === "image/svg+xml") {
      setUploadError("SVG files are not supported — please use PNG or JPG.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
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
      <label className="text-text-dim text-caption block mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…  or click upload →"
          className="flex-1 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
          style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
        />
        <Button onClick={() => fileRef.current?.click()} busy={uploading} title="Upload from your computer">
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {uploadError && <p className="text-danger text-caption mt-1">{uploadError}</p>}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
