import { describe, it, expect, afterEach } from "vitest";
import { opensThread } from "./cardClick";

// A note card, reduced to the parts the click rules care about.
function mount(wrap?: string) {
  document.body.innerHTML = `
    ${wrap ? `<div ${wrap}>` : ""}
    <article id="card">
      <span id="name">Alice</span>
      <p id="text">hello <a id="link" href="https://example.com/">a link</a></p>
      <div data-no-navigate id="actions">
        <div id="band">
          <button id="reply"><svg id="icon"></svg></button>
          <div role="menu" id="menu"><button id="item">Copy text</button></div>
        </div>
        <div id="replybox"><textarea id="field"></textarea></div>
      </div>
    </article>
    ${wrap ? "</div>" : ""}
    <div role="dialog" id="portal"><label id="label">Amount</label></div>
  `;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const card = el("card");
  const click = (id: string, extra: Partial<Parameters<typeof opensThread>[0]> = {}) =>
    opensThread({ card, target: el(id), press: { x: 10, y: 10 }, release: { x: 10, y: 10 }, alreadyOpen: false, ...extra });
  return { card, click };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("opensThread", () => {
  it("opens the thread for a click on the card's own text and padding", () => {
    const { click } = mount();
    expect(click("card")).toBe(true);
    expect(click("name")).toBe(true);
    expect(click("text")).toBe(true);
  });

  it("leaves buttons, links and fields to do their own thing", () => {
    const { click } = mount();
    expect(click("reply")).toBe(false);
    expect(click("icon")).toBe(false);
    expect(click("link")).toBe(false);
    expect(click("field")).toBe(false);
  });

  // The near miss: aiming at Reply and landing a few pixels beside it used to
  // open the thread, which read as a broken button.
  it("does nothing for a click that lands in the action area but on no button", () => {
    const { click } = mount();
    expect(click("actions")).toBe(false);
    expect(click("band")).toBe(false);
    expect(click("replybox")).toBe(false);
  });

  it("does nothing for a click inside an open menu", () => {
    const { click } = mount();
    expect(click("menu")).toBe(false);
    expect(click("item")).toBe(false);
  });

  // React bubbles a portal's events to the component that rendered it.
  it("ignores clicks from a dialog that was portaled out of the card", () => {
    const { click } = mount();
    expect(click("label")).toBe(false);
    expect(click("portal")).toBe(false);
  });

  it("does not open the thread when the press ended as a text selection", () => {
    const { click } = mount();
    expect(click("text", { press: { x: 10, y: 10 }, release: { x: 140, y: 12 } })).toBe(false);
    expect(click("text", { press: { x: 10, y: 10 }, release: { x: 12, y: 11 } })).toBe(true);
  });

  it("still opens the thread when no press was recorded", () => {
    const { click } = mount();
    expect(click("text", { press: null })).toBe(true);
  });

  it("does nothing when the open thread is already about this note", () => {
    const { click } = mount();
    expect(click("text", { alreadyOpen: true })).toBe(false);
  });

  // A card rendered inside something that itself matches the "leave alone"
  // list must still be clickable; only matches inside the card count.
  it("is not disarmed by a matching ancestor outside the card", () => {
    expect(mount('role="dialog"').click("text")).toBe(true);
    expect(mount("data-no-navigate").click("text")).toBe(true);
    expect(mount('role="dialog"').click("reply")).toBe(false);
  });

  it("ignores a click with no element target", () => {
    const { card } = mount();
    expect(opensThread({ card, target: null, press: null, release: { x: 0, y: 0 }, alreadyOpen: false })).toBe(false);
  });
});
