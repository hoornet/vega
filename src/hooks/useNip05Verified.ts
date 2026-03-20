import { useState, useEffect } from "react";

type VerifyStatus = "valid" | "invalid";

const cache = new Map<string, { status: VerifyStatus; checkedAt: number }>();
const TTL = 3600000; // 1 hour

async function verifyNip05(pubkey: string, nip05: string): Promise<VerifyStatus> {
  const parts = nip05.split("@");
  if (parts.length !== 2) return "invalid";
  const [name, domain] = parts;
  try {
    const res = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
    if (!res.ok) return "invalid";
    const json = await res.json();
    const resolved = json?.names?.[name];
    return resolved === pubkey ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

export function useNip05Verified(pubkey: string, nip05: string | undefined): "valid" | "invalid" | "checking" | null {
  const [status, setStatus] = useState<"valid" | "invalid" | "checking" | null>(() => {
    if (!nip05) return null;
    const cached = cache.get(pubkey);
    if (cached && Date.now() - cached.checkedAt < TTL) return cached.status;
    return "checking";
  });

  useEffect(() => {
    if (!nip05) { setStatus(null); return; }

    const cached = cache.get(pubkey);
    if (cached && Date.now() - cached.checkedAt < TTL) {
      setStatus(cached.status);
      return;
    }

    let cancelled = false;
    setStatus("checking");
    verifyNip05(pubkey, nip05).then((result) => {
      if (cancelled) return;
      cache.set(pubkey, { status: result, checkedAt: Date.now() });
      setStatus(result);
    });
    return () => { cancelled = true; };
  }, [pubkey, nip05]);

  return status;
}
