import { useEffect, useState } from "react";

type Nip05Status = "idle" | "checking" | "valid" | "mismatch" | "notfound";

export function Nip05Field({ value, onChange, pubkey }: { value: string; onChange: (v: string) => void; pubkey: string }) {
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
    checking: <span className="text-text-dim text-caption">checking…</span>,
    valid: <span className="text-success text-caption">✓ verified</span>,
    mismatch: <span className="text-danger text-caption">✗ pubkey mismatch</span>,
    notfound: <span className="text-danger text-caption">✗ not found</span>,
  }[status];

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <label className="text-text-dim text-caption">NIP-05 verified name</label>
        {badge}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@domain.com"
        className="w-full bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
        style={{ WebkitUserSelect: "text", userSelect: "text" } as React.CSSProperties}
      />
      <p className="text-text-dim text-caption mt-1">
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
