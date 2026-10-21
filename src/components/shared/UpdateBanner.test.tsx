import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import pkg from "../../../package.json";
import type { ReleaseNotes } from "../../lib/releaseNotes";

const updater = vi.hoisted(() => ({
  state: {
    available: true,
    version: "9.0.2" as string | null,
    body: null as string | null,
    installing: false,
    error: null as string | null,
    canSelfUpdate: true,
    kind: "updater",
    packagedBy: null as string | null,
    install: async () => {},
    dismiss: () => {},
  },
}));
vi.mock("../../hooks/useUpdater", () => ({ useUpdater: () => updater.state }));

const notes = vi.hoisted(() => ({ fetchNotesSince: vi.fn() }));
vi.mock("../../lib/releaseNotes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/releaseNotes")>()),
  fetchNotesSince: notes.fetchNotesSince,
}));

import { UpdateBanner } from "./UpdateBanner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const TWO_RELEASES: ReleaseNotes[] = [
  { version: "9.0.2", title: "Second", body: "### Newer\n\nThe newer change." },
  { version: "9.0.1", title: null, body: "### Older\n\nThe older change." },
];

describe("UpdateBanner", () => {
  beforeEach(() => {
    notes.fetchNotesSince.mockReset();
    updater.state = {
      ...updater.state, available: true, version: "9.0.2", body: null,
      canSelfUpdate: true, kind: "updater", packagedBy: null,
    };
  });

  describe("a Vega that a package manager installed", () => {
    function packagedBy(by: string | null, kind = "package") {
      updater.state = { ...updater.state, canSelfUpdate: false, kind, packagedBy: by };
    }

    it("names the Omarchy repository's command, and says the package takes a day or two", () => {
      packagedBy("omarchy");
      render(<UpdateBanner />);
      expect(screen.getByText("sudo pacman -Syu")).toBeTruthy();
      expect(screen.getByText(/a day or two/)).toBeTruthy();
      expect(screen.queryByText(/vega-nostr-git/)).toBeNull();
      expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Update & restart" })).toBeNull();
    });

    it("names the AUR package it came from, not the development one", () => {
      packagedBy("aur");
      render(<UpdateBanner />);
      expect(screen.getByText("yay -S vega-nostr")).toBeTruthy();
      expect(screen.queryByText(/vega-nostr-git/)).toBeNull();
    });

    it("names the development package for the AUR git package", () => {
      packagedBy("aur-git");
      render(<UpdateBanner />);
      expect(screen.getByText("yay -S vega-nostr-git")).toBeTruthy();
    });

    it("names the Flatpak command for the Flatpak, which runs from /app and used to be taken for a portable build", () => {
      packagedBy("flatpak");
      render(<UpdateBanner />);
      expect(screen.getByText("flatpak update com.veganostr.Vega")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Update & restart" })).toBeNull();
    });

    it("gives no command when it only knows that pacman is there", () => {
      packagedBy(null, "pacman");
      render(<UpdateBanner />);
      expect(screen.getByText(/your package manager/)).toBeTruthy();
      expect(screen.queryByText(/vega-nostr/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
      expect(screen.getByRole("button", { name: "View release" })).toBeTruthy();
    });

    it("gives no command for a packager it does not know", () => {
      packagedBy("nix");
      render(<UpdateBanner />);
      expect(screen.getByText(/your package manager/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    });
  });

  it("shows What's new even when the updater sent no notes, and asks for them only when opened", () => {
    notes.fetchNotesSince.mockReturnValue(new Promise(() => {}));
    render(<UpdateBanner />);
    expect(notes.fetchNotesSince).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(notes.fetchNotesSince).toHaveBeenCalledWith(pkg.version, "9.0.2");
    expect(screen.getByText("Loading what's new…")).toBeTruthy();
  });

  it("renders every release it loaded, newest first, under its version", async () => {
    const answer = deferred<ReleaseNotes[] | null>();
    notes.fetchNotesSince.mockReturnValue(answer.promise);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    answer.resolve(TWO_RELEASES);

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["v9.0.2: Second", "v9.0.1"]);
    expect(screen.getByText(`Everything since ${pkg.version}: 2 releases.`)).toBeTruthy();
    const [newer, older] = headings.map((h) => h.closest("section") as HTMLElement);
    expect(within(newer).getByText("The newer change.")).toBeTruthy();
    expect(within(older).getByText("The older change.")).toBeTruthy();
    expect(screen.queryByText("Loading what's new…")).toBeNull();
    expect(screen.getByRole("button", { name: /Full changelog on GitHub/ })).toBeTruthy();
  });

  it("does not ask again when the panel is closed and opened", async () => {
    notes.fetchNotesSince.mockResolvedValue(TWO_RELEASES);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    await screen.findByText("The newer change.");
    fireEvent.click(screen.getByRole("button", { name: "Hide changes" }));
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(screen.getByText("The newer change.")).toBeTruthy();
    expect(notes.fetchNotesSince).toHaveBeenCalledTimes(1);
  });

  it("says so for a release whose notes are not up yet", async () => {
    notes.fetchNotesSince.mockResolvedValue([{ version: "9.0.2", title: null, body: "" }]);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("No notes for this version yet.")).toBeTruthy();
    expect(screen.queryByText(/Everything since/)).toBeNull();
  });

  it("falls back to the updater's notes when GitHub could not be read", async () => {
    updater.state = { ...updater.state, body: "## Vega v9.0.2\n\n### v9.0.2 — Second\n\nFrom latest.json." };
    notes.fetchNotesSince.mockResolvedValue(null);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("From latest.json.")).toBeTruthy();
    expect(screen.queryByText("The notes could not be loaded.")).toBeNull();
  });

  it("does not pass off an older version's notes as the offered one's", async () => {
    // The workflow's fixed text: its newest section is for a version long gone.
    updater.state = { ...updater.state, body: "## Vega v9.0.2\n\n### v0.14.0 — Old\n\nOld notes." };
    notes.fetchNotesSince.mockResolvedValue(null);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("The notes could not be loaded.")).toBeTruthy();
    expect(screen.queryByText("Old notes.")).toBeNull();
    expect(screen.getByRole("button", { name: /Full changelog on GitHub/ })).toBeTruthy();
  });

  it("says the notes could not be loaded when there is nothing to fall back to", async () => {
    notes.fetchNotesSince.mockResolvedValue(null);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("The notes could not be loaded.")).toBeTruthy();
  });
});
