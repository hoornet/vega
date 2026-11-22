import { describe, it, expect, vi } from "vitest";
import { nip19 } from "@nostr-dev-kit/ndk";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.0.0") }));

import { DEV_NPUB, DEV_PUBKEY } from "./AboutView";

// Support shows one key and zaps another only if the two constants disagree.
describe("Support's developer key", () => {
  it("the npub shown is the key zapped", () => {
    expect(nip19.decode(DEV_NPUB).data).toBe(DEV_PUBKEY);
  });
});
