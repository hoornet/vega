import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import { Tabs, tabPanelProps, type TabItem } from "./Tabs";
import { ViewHeader } from "./ViewHeader";

type Id = "notes" | "articles" | "media" | "likes";
const TABS: TabItem<Id>[] = [
  { id: "notes", label: "Notes", count: 12 },
  { id: "articles", label: "Articles", unread: 3 },
  { id: "media", label: "Media", disabled: true },
  { id: "likes", label: "Likes" },
];

function setup(value: Id = "notes", tabs: TabItem<Id>[] = TABS) {
  const onChange = vi.fn();
  render(<Tabs label="Profile" tabs={tabs} value={value} onChange={onChange} />);
  return onChange;
}
// Selection really changes, as in the app.
function Live({ start = "notes" as Id, tabs = TABS, onSelect = (_: Id) => {} }) {
  const [value, setValue] = useState<Id>(start);
  return <Tabs label="Profile" panel="p" tabs={tabs} value={value} onChange={(id) => { onSelect(id); setValue(id); }} />;
}
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) }) as HTMLButtonElement;
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement as Element, { key: k, ...init });
const focused = () => (document.activeElement as HTMLElement).textContent;

describe("Tabs", () => {
  it("is a named tab list that marks the selected tab", () => {
    setup("articles");
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Profile");
    expect(tab("Articles").getAttribute("aria-selected")).toBe("true");
    expect(tab("Notes").getAttribute("aria-selected")).toBe("false");
  });

  it("selects a tab on click", () => {
    const onChange = setup();
    fireEvent.click(tab("Likes"));
    expect(onChange).toHaveBeenCalledWith("likes");
  });

  it("does not select a disabled tab", () => {
    const onChange = setup();
    expect(tab("Media").disabled).toBe(true);
    fireEvent.click(tab("Media"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a total quietly and says it in the tab's name", () => {
    setup();
    expect(tab("Notes").textContent).toBe("Notes12");
    expect(tab("Notes").getAttribute("aria-label")).toBe("Notes, 12");
    expect(tab("Likes").textContent).toBe("Likes");
    expect(tab("Likes").hasAttribute("aria-label")).toBe(false);
  });

  // "Articles 3" beside "12 saved" read as three saved articles. Unread is a
  // different kind of number and is drawn and named as one.
  it("shows an unread count as a badge, and names it as unread", () => {
    setup();
    const badge = tab("Articles").querySelector("span")!;
    expect(badge.textContent).toBe("3");
    expect(` ${badge.className} `).toContain(" bg-accent ");
    expect(tab("Articles").getAttribute("aria-label")).toBe("Articles, 3 unread");
  });

  it("shows no badge for nothing unread", () => {
    setup("notes", [{ id: "notes", label: "Notes" }, { id: "articles", label: "Articles", unread: 0 }]);
    expect(tab("Articles").textContent).toBe("Articles");
  });
});

describe("Tabs, keyboard", () => {
  it("keeps exactly one tab in the Tab order: the selected one", () => {
    setup("articles");
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(["Articles3"]);
  });

  // Articles, Following tab, then sign out: the selected tab is disabled. With
  // the only tab stop on it, the list could not be reached by keyboard at all.
  it("puts the tab stop on the first usable tab when the selected one is disabled", () => {
    setup("media");
    expect(tab("Media").tabIndex).toBe(-1);
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(["Notes12"]);
  });

  it("puts the tab stop on the first usable tab when the value matches none", () => {
    render(<Tabs label="x" tabs={TABS} value={"gone" as Id} onChange={() => {}} />);
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(["Notes12"]);
  });

  it("moves the tab stop with the selection", () => {
    render(<Live />);
    fireEvent.click(tab("Likes"));
    expect(tab("Likes").tabIndex).toBe(0);
    expect(tab("Notes").tabIndex).toBe(-1);
  });

  // Selecting a tab loads: the feed fetches, Podcasts fetches. Arrows that
  // selected would start one load per tab passed.
  it("moves focus with the arrow keys without selecting", () => {
    const onSelect = vi.fn();
    render(<Live onSelect={onSelect} />);
    tab("Notes").focus();
    key("ArrowRight");
    expect(focused()).toBe("Articles3");
    key("ArrowRight");
    expect(focused()).toBe("Likes"); // over the disabled Media
    expect(onSelect).not.toHaveBeenCalled();
    expect(tab("Notes").getAttribute("aria-selected")).toBe("true");
  });

  it("selects the focused tab when it is activated", () => {
    const onSelect = vi.fn();
    render(<Live onSelect={onSelect} />);
    tab("Notes").focus();
    key("ArrowRight");
    fireEvent.click(document.activeElement as Element); // what Enter or Space does on a button
    expect(onSelect).toHaveBeenCalledWith("articles");
    expect(tab("Articles").getAttribute("aria-selected")).toBe("true");
  });

  it("wraps round in both directions", () => {
    render(<Live />);
    tab("Notes").focus();
    key("ArrowLeft");
    expect(focused()).toBe("Likes");
    key("ArrowRight");
    expect(focused()).toBe("Notes12");
  });

  it("jumps to the ends with Home and End", () => {
    render(<Live start="articles" />);
    tab("Articles").focus();
    key("End");
    expect(focused()).toBe("Likes");
    key("Home");
    expect(focused()).toBe("Notes12");
  });

  it("claims the keys it handles and leaves the rest to the app", () => {
    render(<Live />);
    tab("Notes").focus();
    const handled = createEvent.keyDown(tab("Notes"), { key: "ArrowRight" });
    fireEvent(tab("Notes"), handled);
    expect(handled.defaultPrevented).toBe(true);
    for (const init of [{ key: "a" }, { key: "ArrowDown" }, { key: "ArrowRight", altKey: true }, { key: "End", ctrlKey: true }]) {
      const before = focused();
      const ev = createEvent.keyDown(document.activeElement as Element, init);
      fireEvent(document.activeElement as Element, ev);
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
      expect(focused(), JSON.stringify(init)).toBe(before);
    }
  });

  it("stays put with a single tab", () => {
    render(<Tabs label="x" tabs={[{ id: "only", label: "Only" }]} value="only" onChange={() => {}} />);
    screen.getByRole("tab").focus();
    key("ArrowRight");
    key("ArrowLeft");
    key("End");
    expect(focused()).toBe("Only");
  });

  it("does nothing when no tab can be used", () => {
    render(<Tabs label="x" tabs={[{ id: "a", label: "A", disabled: true }]} value="a" onChange={() => {}} />);
    expect(() => fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" })).not.toThrow();
  });
});

describe("Tabs and their panel", () => {
  it("links each tab to the panel, and the panel to the selected tab", () => {
    render(
      <>
        <Tabs label="Profile" panel="profile-panel" tabs={TABS} value="articles" onChange={() => {}} />
        <div {...tabPanelProps("profile-panel", "articles")}>content</div>
      </>,
    );
    const panel = screen.getByRole("tabpanel");
    expect(tab("Articles").getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Articles").id);
    expect(tab("Notes").id).not.toBe(tab("Articles").id);
  });

  it("adds no ids when there is no panel to point at", () => {
    setup();
    expect(tab("Notes").hasAttribute("aria-controls")).toBe(false);
    expect(tab("Notes").id).toBe("");
  });
});

describe("ViewHeader", () => {
  it("shows the title as the page's heading", () => {
    render(<ViewHeader title="Bookmarks" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bookmarks");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Back only when there is somewhere to go back to", () => {
    const onBack = vi.fn();
    render(<ViewHeader title="Thread" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("puts meta after the title and actions at the end", () => {
    render(<ViewHeader title="Relays" meta="4 online" actions={<button>Check all</button>} />);
    expect(screen.getByRole("banner").textContent).toBe("Relays4 onlineCheck all");
  });

  // Loose in a wrapping row, a long title took a line of its own and the
  // header became three rows: Back, title, count.
  it("keeps Back, title and meta together in one group", () => {
    render(<ViewHeader title={"#" + "x".repeat(80)} onBack={() => {}} meta="12 notes" actions={<button>Go</button>} />);
    const group = screen.getByRole("heading").parentElement!;
    expect(group.contains(screen.getByRole("button", { name: "Back" }))).toBe(true);
    expect(group.textContent).toContain("12 notes");
    expect(group.contains(screen.getByRole("button", { name: "Go" }))).toBe(false);
    expect(` ${group.className} `).toContain(" min-h-12 ");
  });

  it("carries a field in the title's place", () => {
    render(<ViewHeader hiddenTitle="Search" actions={<button>Search</button>}><input aria-label="Search Nostr" /></ViewHeader>);
    expect(screen.getByRole("textbox", { name: "Search Nostr" })).toBeTruthy();
    // still a page heading for someone who cannot see the field
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Search");
    expect(` ${h1.className} `).toContain(" sr-only ");
  });

  it("renders nothing for a slot given null or false", () => {
    render(<ViewHeader title="Profile" meta={null} actions={false} />);
    expect(screen.getByRole("banner").children.length).toBe(1);
  });

  it("hides the actions area when what it was given renders nothing", () => {
    render(<ViewHeader title="Profile" actions={<>{false}</>} />);
    const area = screen.getByRole("banner").lastElementChild!;
    expect(area.childElementCount).toBe(0);
    expect(` ${area.className} `).toContain(" empty:hidden ");
  });
});

describe("ViewHeader with tabs in the title's place", () => {
  const feed = (
    <ViewHeader
      hiddenTitle="Feed"
      tabs={<Tabs label="Feed" tabs={[{ id: "following", label: "Following" }, { id: "global", label: "Global" }]} value="following" onChange={() => {}} />}
      actions={<button>Refresh</button>}
    />
  );

  it("tells the tabs they are in a header, so they draw no divider of their own", () => {
    render(feed);
    const list = screen.getByRole("tablist");
    expect(` ${list.className} `).not.toContain(" border-b ");
    expect(` ${screen.getAllByRole("tab")[0].className} `).toContain(" min-h-12 ");
  });

  it("draws a divider under tabs that stand on their own row", () => {
    render(<Tabs label="x" tabs={[{ id: "a", label: "A" }]} value="a" onChange={() => {}} />);
    expect(` ${screen.getByRole("tablist").className} `).toContain(" border-b ");
    expect(` ${screen.getByRole("tab").className} `).toContain(" h-9 ");
  });

  // In a narrow window the feed's tabs were squeezed to nothing and drawn
  // under the controls beside them. They must keep their width, and the
  // controls wrap above them so the tab underline stays on the divider.
  // (jsdom has no layout: these pin the classes; the overlap itself is
  // checked in the running app.)
  it("never shrinks tabs, and wraps the controls above them", () => {
    render(feed);
    expect(` ${screen.getByRole("banner").className} `).toContain(" flex-wrap-reverse ");
    expect(` ${screen.getByRole("tablist").parentElement!.className} `).toContain(" shrink-0 ");
  });

  it("wraps the usual way when the header has a title", () => {
    render(<ViewHeader title="Profile" actions={<button>Follow</button>} />);
    const cls = ` ${screen.getByRole("banner").className} `;
    expect(cls).toContain(" flex-wrap ");
    expect(cls).not.toContain(" flex-wrap-reverse ");
  });
});
