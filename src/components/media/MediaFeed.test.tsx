import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ fetchMediaFeed: vi.fn() }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], contentMatchesMutedKeyword: () => false }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.id}</article> }));

import { MediaFeed } from "./MediaFeed";
import { fetchMediaFeed } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const note = (id: string, content: string) => ({ id, content, created_at: 1000, kind: 1, pubkey: "pk", tags: [] }) as unknown as NDKEvent;
const PHOTO = note("photo", "look https://example.com/a.jpg");
const CLIP = note("clip", "watch https://example.com/a.mp4");
const TEXT = note("text", "no media here");
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };
const settled = () => waitFor(() => expect(screen.queryByRole("status")).toBeNull());
const rows = () => screen.queryAllByRole("article").map((e) => e.textContent);

beforeEach(() => { vi.mocked(fetchMediaFeed).mockReset(); });
afterEach(cleanup);

describe("MediaFeed", () => {
  it("shows a skeleton while it loads, then the notes that carry media", async () => {
    vi.mocked(fetchMediaFeed).mockImplementation(answering([PHOTO, TEXT, CLIP]));
    render(<MediaFeed />);
    expect(screen.getByRole("status", { name: "Loading media…" })).toBeTruthy();
    await settled();
    expect(rows()).toEqual(["photo", "clip"]);
  });

  it("says a tab has none of its kind when the feed loaded", async () => {
    vi.mocked(fetchMediaFeed).mockImplementation(answering([PHOTO]));
    render(<MediaFeed />);
    await settled();
    fireEvent.click(screen.getByRole("tab", { name: "Audio" }));
    expect(screen.getByText("No audio found.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Notes came back and none carries media: a relay answered, so this is empty.
  it("says there is no media when the relays answered with notes that have none", async () => {
    vi.mocked(fetchMediaFeed).mockImplementation(answering([TEXT]));
    render(<MediaFeed />);
    await settled();
    expect(screen.getByText("No media found.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: on every tab this used to read "No media found."
  it("says the relays could not be reached when nobody answered, on every tab, and asks again on Try again", async () => {
    vi.mocked(fetchMediaFeed).mockImplementationOnce(timingOut).mockImplementation(answering([PHOTO]));
    render(<MediaFeed />);
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("so media can't be loaded");
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/No .* found/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settled();
    expect(rows()).toEqual(["photo"]);
  });

  it("shows a failure, not an empty list", async () => {
    vi.mocked(fetchMediaFeed).mockRejectedValue(new Error("relay said no"));
    render(<MediaFeed />);
    await settled();
    expect(screen.getByRole("alert").textContent).toContain("relay said no");
    expect(screen.queryByText(/No .* found/)).toBeNull();
  });
});
