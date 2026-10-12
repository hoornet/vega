import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AvatarInitial } from "./AvatarInitial";

afterEach(cleanup);
/** The inside of the placeholder, drawn for one account. Each call starts from an empty page. */
const drawn = (profile: unknown) => {
  cleanup();
  return render(<AvatarInitial profile={profile} />).container;
};

// What stands in the round placeholder where a picture would be.
describe("AvatarInitial", () => {
  it("is the first letter of the account's name", () => {
    expect(drawn({ name: "ana" }).textContent).toBe("A");
    expect(drawn({ name: "ana" }).querySelector("svg")).toBeNull();
  });

  it("goes by the display name before the name, as the name shown does", () => {
    expect(drawn({ displayName: "Zed", name: "ana" }).textContent).toBe("Z");
  });

  it("reads a saved account and a search result the same way", () => {
    expect(drawn({ pubkey: "aa", npub: "npub1xyz", name: "bo" }).textContent).toBe("B");
  });

  // A letter taken from a key says nothing: "N" for every npub, or a hex digit.
  it("is the outline of a person, not a letter, for an account with no name", () => {
    for (const profile of [null, undefined, {}, { name: "   " }, { name: 42 }, { npub: "npub1xyz" }]) {
      const disc = drawn(profile);
      expect(disc.textContent).toBe("");
      const icon = disc.querySelector("svg");
      expect(icon).not.toBeNull();
      // Decoration: the name beside it, or the label of the button around it, says who it is.
      expect(icon!.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
