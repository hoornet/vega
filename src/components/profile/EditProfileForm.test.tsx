import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const user = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  saveProfile: vi.fn(),
  fetchOwnProfile: vi.fn(),
  canSign: true,
}));
vi.mock("../../stores/user", () => ({ useUserStore: () => user, useCanSign: () => user.canSign }));
vi.mock("../shared/LoginModal", () => ({ LoginModal: () => <div role="dialog" aria-label="Login" /> }));
vi.mock("./ImageField", () => ({ ImageField: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock("./Nip05Field", () => ({ Nip05Field: () => <div>verified name</div> }));

import { EditProfileForm } from "./EditProfileForm";

const ME = "aa".repeat(32);
const onSaved = vi.fn();
const open = () => render(<EditProfileForm pubkey={ME} onSaved={onSaved} />);
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Save profile|Saving/ })); }); };
const field = (placeholder: string) => screen.getByPlaceholderText(placeholder) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  user.profile = { name: "ana", displayName: "Ana K.", about: "hello", picture: "https://example.com/a.png" };
  user.canSign = true;
  user.saveProfile.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("EditProfileForm", () => {
  it("opens on the profile as it is", () => {
    open();
    expect(field("Your name").value).toBe("Ana K.");
    expect(field("yourname").value).toBe("ana");
    expect((screen.getByPlaceholderText("Tell people about yourself…") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("saves what is in the form, trimmed, with empty fields left out", async () => {
    open();
    fireEvent.change(field("Your name"), { target: { value: "  Ana Kovač  " } });
    fireEvent.change(field("yourname"), { target: { value: "   " } });
    await save();
    expect(user.saveProfile).toHaveBeenCalledTimes(1);
    // For the account the form was opened for, whoever is signed in by now.
    expect(user.saveProfile).toHaveBeenCalledWith({
      name: undefined,
      display_name: "Ana Kovač",
      about: "hello",
      picture: "https://example.com/a.png",
      banner: undefined,
      website: undefined,
      nip05: undefined,
      lud16: undefined,
    }, ME);
  });

  // It used to throw away what it knew and ask the relays, and a fetch
  // straight after a publish can come back with nothing or with the old one.
  it("does not ask the relays for the profile it just published", async () => {
    open();
    await save();
    expect(user.fetchOwnProfile).not.toHaveBeenCalled();
  });

  it("says Saved, then closes", async () => {
    vi.useFakeTimers();
    open();
    await save();
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("says why when no relay took it, and keeps what was typed", async () => {
    user.saveProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    open();
    fireEvent.change(field("Your name"), { target: { value: "Ana Kovač" } });
    await save();
    expect(screen.getByText("Couldn't publish: none of your relays accepted it. Your changes are still here. Check your relays and try again.")).toBeTruthy();
    expect(field("Your name").value).toBe("Ana Kovač");
    expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    // And it can be tried again.
    expect(screen.getByRole("button", { name: "Save profile" }).getAttribute("aria-busy")).toBeNull();
  });

  it("offers sign-in, not a save, to an account that cannot sign", () => {
    user.canSign = false;
    open();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to save" }));
    expect(screen.getByRole("dialog", { name: "Login" })).toBeTruthy();
    expect(user.saveProfile).not.toHaveBeenCalled();
  });
});
