import { fetchWithProxy as fetch } from "../proxy";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { getNDK } from "./core";
import { debug } from "../debug";

const VERTEX_API = "https://relay.vertexlab.io/api/v1/dvms";
const VERTEX_TIMEOUT = 10000;

export interface ReputationEntry {
  pubkey: string;
  rank: number;
  follows?: number;
  followers?: number;
}

export interface ReputationResult {
  topFollowers: ReputationEntry[];
  totalNodes: number;
}

/**
 * Call Vertex Verify Reputation DVM (kind 5312).
 * Returns personalized reputation data for a target pubkey.
 */
export async function verifyReputation(targetPubkey: string, limit = 7): Promise<ReputationResult | null> {
  const ndk = getNDK();
  if (!ndk.signer) return null;

  try {
    // Build and sign the DVM request event
    const event = new NDKEvent(ndk);
    event.kind = 5312;
    event.content = "";
    event.tags = [
      ["param", "target", targetPubkey],
      ["param", "limit", String(limit)],
    ];
    await event.sign();

    const raw = event.rawEvent();
    debug.log("vertex:verifyReputation", targetPubkey.slice(0, 8), "requesting...");

    const resp = await fetch(VERTEX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
      connectTimeout: VERTEX_TIMEOUT,
    });

    if (!resp.ok) {
      debug.warn("vertex:verifyReputation HTTP", resp.status);
      return null;
    }

    const responseEvent = await resp.json();

    // Parse the kind 6312 response
    if (responseEvent.kind === 7000) {
      debug.warn("vertex:verifyReputation DVM error:", responseEvent.content);
      return null;
    }

    const totalNodes = parseInt(
      responseEvent.tags?.find((t: string[]) => t[0] === "nodes")?.[1] ?? "0",
      10,
    );

    const topFollowers: ReputationEntry[] = JSON.parse(responseEvent.content || "[]");

    debug.log("vertex:verifyReputation", targetPubkey.slice(0, 8), "→", topFollowers.length, "followers, nodes:", totalNodes);

    return { topFollowers, totalNodes };
  } catch (err) {
    debug.warn("vertex:verifyReputation failed:", err);
    return null;
  }
}
