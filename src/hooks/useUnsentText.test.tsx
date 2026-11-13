import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useUnsentText } from "./useUnsentText";
import { hasUnsentText, unsentTextNotice, type UnsentKind } from "../lib/unsentText";

afterEach(cleanup);

const box = (text: string | boolean, kind: UnsentKind = "reply") =>
  renderHook(({ t, k }) => useUnsentText(t, k), { initialProps: { t: text, k: kind } });

describe("useUnsentText", () => {
  it("holds text while there is some, and lets go when it is cleared", () => {
    const { rerender } = box("");
    expect(hasUnsentText()).toBe(false);
    rerender({ t: "a reply", k: "reply" });
    expect(hasUnsentText()).toBe(true);
    rerender({ t: "", k: "reply" });
    expect(hasUnsentText()).toBe(false);
  });

  it("does not hold text that is only spaces", () => {
    box("  \n ");
    expect(hasUnsentText()).toBe(false);
  });

  it("lets go when the box goes", () => {
    const { unmount } = box("a reply");
    expect(hasUnsentText()).toBe(true);
    unmount();
    expect(hasUnsentText()).toBe(false);
  });

  it("takes whether a form has changed", () => {
    const { rerender } = box(false, "profile");
    expect(hasUnsentText()).toBe(false);
    rerender({ t: true, k: "profile" });
    expect(unsentTextNotice()).toMatch(/^Your profile changes aren't saved yet/);
  });

  it("holds while any box does, and says what the newest one holds", () => {
    const message = box("hello", "message");
    const comment = box("nice piece", "comment");
    expect(unsentTextNotice()).toMatch(/^Your comment isn't sent yet/);
    comment.unmount();
    expect(unsentTextNotice()).toMatch(/^Your message isn't sent yet/);
    message.unmount();
    expect(hasUnsentText()).toBe(false);
    expect(unsentTextNotice()).toBeNull();
  });
});
