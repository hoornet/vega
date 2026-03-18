import { fetch } from "@tauri-apps/plugin-http";
import { getNDK } from "./nostr";
import { NDKEvent } from "@nostr-dev-kit/ndk";

const UPLOAD_SERVICES = [
  "https://nostr.build/api/v2/upload/files",
  "https://void.cat/upload",
  "https://nostrimg.com/api/upload",
];

/**
 * Create a NIP-98 HTTP Auth event (kind 27235) for a given URL and method.
 * Returns a base64-encoded signed event for the Authorization header.
 */
async function createNip98AuthHeader(url: string, method: string): Promise<string> {
  const ndk = getNDK();
  if (!ndk.signer) throw new Error("Not logged in — cannot sign NIP-98 auth");

  const event = new NDKEvent(ndk);
  event.kind = 27235;
  event.created_at = Math.floor(Date.now() / 1000);
  event.content = "";
  event.tags = [
    ["u", url],
    ["method", method.toUpperCase()],
  ];
  await event.sign();
  const encoded = btoa(JSON.stringify(event.rawEvent()));
  return `Nostr ${encoded}`;
}

/**
 * Upload an image file to nostr.build and return the hosted URL.
 * Uses Tauri's HTTP plugin to bypass WebView CORS/fetch restrictions.
 *
 * Clipboard-pasted images sometimes arrive as File objects that Tauri's
 * HTTP plugin can't serialize correctly, so we read the bytes ourselves
 * and build a proper Blob with the correct MIME type.
 */
export async function uploadImage(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadBytes(bytes, file.name || "image.png", file.type || "image/png");
}

/**
 * Upload raw bytes with NIP-98 auth. Tries nostr.build first, then fallbacks.
 */
export async function uploadBytes(bytes: Uint8Array, fileName: string, mimeType: string): Promise<string> {
  const blob = new Blob([bytes], { type: mimeType });
  const errors: string[] = [];

  for (const serviceUrl of UPLOAD_SERVICES) {
    try {
      const form = new FormData();
      form.append("file", blob, fileName);

      const headers: Record<string, string> = {};
      try {
        headers["Authorization"] = await createNip98AuthHeader(serviceUrl, "POST");
      } catch {
        // If not logged in, try without auth (some services allow anonymous)
      }

      const resp = await fetch(serviceUrl, {
        method: "POST",
        body: form,
        headers,
      });

      if (!resp.ok) {
        errors.push(`${serviceUrl}: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      // nostr.build response format
      if (data.status === "success" && data.data?.[0]?.url) {
        return data.data[0].url as string;
      }
      // void.cat response format
      if (data.file?.url) {
        return data.file.url as string;
      }
      // nostrimg.com response format
      if (data.url) {
        return data.url as string;
      }

      errors.push(`${serviceUrl}: no URL in response`);
    } catch (err) {
      errors.push(`${serviceUrl}: ${err}`);
    }
  }

  throw new Error(`All upload services failed:\n${errors.join("\n")}`);
}
