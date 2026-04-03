import { useState } from "react";
import QRCode from "react-qr-code";
import { ZapModal } from "../zap/ZapModal";
import pkg from "../../../package.json";

const DEV_NPUB   = "npub1ezt7xcq87ljj65jkjsuagwll4yp75tacgkuyjdhkw6mza8j3azfq2vrvl6";
const DEV_PUBKEY = "c897e36007f7e52d52569439d43bffa903ea2fb845b84936f676b62e9e51e892";
const LIGHTNING_ADDRESS = "jure@getalby.com";
const BITCOIN_ADDRESS = "bc1qcgaupf80j28ca537xjlcs9dm9s03khezjs7crp";
const KOFI_URL = "https://ko-fi.com/jure";
const GITHUB_URL = "https://github.com/hoornet/vega";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/hoornet";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handle}
      className="text-text-dim hover:text-accent text-[10px] transition-colors ml-2 shrink-0"
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

function QRBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="bg-white p-2.5 inline-block">
        <QRCode value={value} size={120} />
      </div>
      <div className="flex items-center gap-1 max-w-[160px]">
        <span className="text-text-dim text-[10px] font-mono truncate">{label}</span>
        <CopyButton text={label} />
      </div>
    </div>
  );
}

export function AboutView() {
  const [showZap, setShowZap] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-text text-lg font-medium tracking-tight mb-2">Support Vega</h1>
          <p className="text-text-muted text-[13px] leading-relaxed">
            Vega is free, open-source, and built by one person. If it's useful to you,
            any support — a zap, a share, a star on GitHub — genuinely helps.
          </p>
        </div>

        {/* Zap */}
        <section className="mb-8">
          <h2 className="text-text-dim text-[10px] uppercase tracking-widest mb-3">⚡ Zap the developer</h2>
          <p className="text-text-muted text-[12px] mb-3">
            Send sats directly from Vega using your connected Lightning wallet.
          </p>
          <button
            onClick={() => setShowZap(true)}
            className="px-4 py-2 text-[12px] font-medium bg-zap hover:bg-zap/90 text-zap-text transition-colors"
          >
            ⚡ Zap hoornet
          </button>
          <p className="text-text-dim text-[10px] mt-2 font-mono break-all">{DEV_NPUB}</p>
        </section>

        {/* QR codes */}
        <section className="mb-8">
          <h2 className="text-text-dim text-[10px] uppercase tracking-widest mb-4">Scan to send</h2>
          <div className="flex justify-between gap-8">
            <div>
              <div className="text-text-muted text-[11px] mb-2">Lightning</div>
              <QRBlock value={`lightning:${LIGHTNING_ADDRESS}`} label={LIGHTNING_ADDRESS} />
            </div>
            <div>
              <div className="text-text-muted text-[11px] mb-2">Bitcoin</div>
              <QRBlock value={`bitcoin:${BITCOIN_ADDRESS}`} label={BITCOIN_ADDRESS} />
            </div>
          </div>
        </section>

        {/* Links */}
        <section className="mb-8">
          <h2 className="text-text-dim text-[10px] uppercase tracking-widest mb-3">Other ways to help</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-text-muted text-[12px] w-16 shrink-0">Ko-fi</span>
              <a
                href={KOFI_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-[12px] hover:text-accent-hover transition-colors"
              >
                {KOFI_URL} ↗
              </a>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-muted text-[12px] w-16 shrink-0">GitHub</span>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-[12px] hover:text-accent-hover transition-colors"
              >
                {GITHUB_URL} ↗
              </a>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-muted text-[12px] w-16 shrink-0">Sponsors</span>
              <a
                href={GITHUB_SPONSORS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-[12px] hover:text-accent-hover transition-colors"
              >
                {GITHUB_SPONSORS_URL} ↗
              </a>
            </div>
          </div>
        </section>

        {/* Version / About */}
        <section className="border-t border-border pt-6">
          <div className="text-text-dim text-[11px] space-y-1">
            <div>Vega v{pkg.version} — MIT License — Copyright (c) 2026 Jure Sršen</div>
            <div>
              Built with{" "}
              <a href="https://tauri.app" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover transition-colors">Tauri</a>
              {" · "}
              <a href="https://github.com/nostr-dev-kit/ndk" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover transition-colors">NDK</a>
              {" · "}
              <a href="https://nostr.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover transition-colors">Nostr</a>
            </div>
          </div>
        </section>
      </div>

      {showZap && (
        <ZapModal
          target={{ type: "profile", pubkey: DEV_PUBKEY }}
          recipientName="hoornet"
          onClose={() => setShowZap(false)}
        />
      )}
    </div>
  );
}
