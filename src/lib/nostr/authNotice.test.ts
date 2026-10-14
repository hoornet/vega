import { describe, it, expect, beforeEach } from "vitest";
import { announceAuthFailure } from "./core";
import { useToastStore } from "../../stores/toast";
import { useUIStore } from "../../stores/ui";

// A relay that does not accept Vega's sign-in used to be reported as a
// nine-second warning nobody could act on. It now says what it costs, stays
// longer, and leads to the view where it can be dealt with.

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useUIStore.setState({ currentView: "feed" });
});

describe("announceAuthFailure", () => {
  it("says what it means for the user, quotes the relay, and leads to Relays", () => {
    announceAuthFailure({ url: "wss://inbox.example/" }, new Error("relay needs serviceUrl to be configured before AUTH can work"));
    expect(toasts()).toHaveLength(1);
    const [toast] = toasts();
    expect(toast.type).toBe("warning");
    expect(toast.message).toContain("inbox.example didn't accept Vega's sign-in");
    expect(toast.message).toContain("private messages stored only there may be missing");
    expect(toast.message).toContain("relay needs serviceUrl");
    expect(toast.autoCloseMs).toBe(12000);
    expect(toast.action?.label).toBe("Relays");
    toast.action!.run();
    expect(useUIStore.getState().currentView).toBe("relays");
  });

  // A reconnect loop must not become a toast loop.
  it("says it once per relay", () => {
    announceAuthFailure({ url: "wss://once.example/" }, new Error("no"));
    useToastStore.setState({ toasts: [] });
    announceAuthFailure({ url: "wss://once.example/" }, new Error("no"));
    expect(toasts()).toEqual([]);
    announceAuthFailure({ url: "wss://another.example/" }, new Error("no"));
    expect(toasts()).toHaveLength(1);
  });

  // A permission problem is fixed in the signer, where nobody thinks to look on their own.
  it("points at the signer when it was the signer that refused", () => {
    announceAuthFailure({ url: "wss://signer.example/" }, new Error("Permission denied for sign_event kind:22242"));
    const [toast] = toasts();
    expect(toast.message).toContain("Your signer refused to sign you in to signer.example");
    expect(toast.message).toContain("kind 22242");
    expect(toast.message).not.toContain("didn't accept Vega's sign-in");
    expect(toast.action?.label).toBe("Relays");
  });

  // A reset closes every socket; NDK fails the pending AUTH with "Relay <url>
  // disconnected" and the relay emits auth:failed with it. Nobody refused.
  it("says nothing when the connection went before the relay answered, and keeps the relay's one notice", () => {
    announceAuthFailure({ url: "wss://reset.example/" }, new Error("Relay wss://reset.example/ disconnected"));
    expect(toasts()).toEqual([]);
    announceAuthFailure({ url: "wss://reset.example/" }, new Error("Permission denied for sign_event kind:22242"));
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toContain("Your signer refused");
  });
});
