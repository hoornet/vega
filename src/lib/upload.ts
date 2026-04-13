import { fetch } from "@tauri-apps/plugin-http";
import { getNDK } from "./nostr";
import { NDKEvent } from "@nostr-dev-kit/ndk";

interface UploadService {
  url: string;
  field: string; // multipart field name expected by the service
}

const UPLOAD_SERVICES: UploadService[] = [
  { url: "https://nostr.build/api/v2/nip96/upload", field: "file" },
  { url: "https://files.sovbit.host/api/v2/media", field: "file" },
  { url: "https://nostrimg.com/api/upload", field: "file" },
];

/**
 * Create a NIP-98 HTTP Auth event (kind 27235) for a given URL and method.
 * Returns a base64-encoded signed event for the Authorization header.
 */
async function createNip98AuthHeader(url: string, method: string, body?: Uint8Array): Promise<string> {
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

  if (body) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", body);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    event.tags.push(["payload", hashHex]);
  }

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
 * Build multipart/form-data body manually as Uint8Array.
 * WebKitGTK on Linux/Wayland can't serialize FormData with Blob objects
 * through Tauri's HTTP plugin, so we construct the raw bytes ourselves.
 */
function buildMultipart(fieldName: string, data: Uint8Array, fileName: string, mimeType: string): { body: Uint8Array; contentType: string } {
  const boundary = "----VegaUpload" + Math.random().toString(36).slice(2);
  const encoder = new TextEncoder();

  const header = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(header.length + data.length + footer.length);
  body.set(header, 0);
  body.set(data, header.length);
  body.set(footer, header.length + data.length);

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Upload raw bytes with NIP-98 auth. Tries nostr.build first, then fallbacks.
 */
export async function uploadBytes(bytes: Uint8Array, fileName: string, mimeType: string): Promise<string> {
  const errors: string[] = [];

  for (const service of UPLOAD_SERVICES) {
    const { body, contentType } = buildMultipart(service.field, bytes, fileName, mimeType);
    try {
      const headers: Record<string, string> = { "Content-Type": contentType };
      try {
        headers["Authorization"] = await createNip98AuthHeader(service.url, "POST", body);
      } catch {
        // If not logged in, try without auth (some services allow anonymous)
      }

      const resp = await fetch(service.url, {
        method: "POST",
        body,
        headers,
      });

      if (!resp.ok) {
        errors.push(`${service.url}: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();

      // NIP-96 standard response format
      if (data.nip94_event?.tags) {
        const urlTag = data.nip94_event.tags.find((t: string[]) => t[0] === "url");
        if (urlTag?.[1]) return urlTag[1] as string;
      }
      // nostr.build legacy / plain url field
      if (data.status === "success" && data.data?.[0]?.url) {
        return data.data[0].url as string;
      }
      if (data.url) {
        return data.url as string;
      }

      errors.push(`${service.url}: no URL in response`);
    } catch (err) {
      errors.push(`${service.url}: ${err}`);
    }
  }

  throw new Error(`All upload services failed:\n${errors.join("\n")}`);
}
