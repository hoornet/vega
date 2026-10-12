import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { V4VSettings } from "./V4VSettings";
import { useV4VStore } from "../../stores/v4v";

// This row lays out its own label, so the switch is named only by a reference
// to it. Rename one side and the switch is nameless again with every type
// check still green; this is the test that notices.
describe("V4VSettings: the auto-stream switch", () => {
  beforeEach(() => {
    localStorage.clear();
    // The store refuses to turn auto-stream on until both limits are set.
    useV4VStore.setState({ autoEnabled: false, perEpisodeCap: 100, weeklyBudget: 1000 });
  });
  const sw = () => screen.getByRole("switch", { name: "Auto-stream" });

  it("has a name, a state and a description", () => {
    render(<V4VSettings />);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(document.getElementById(sw().getAttribute("aria-labelledby")!)?.textContent).toBe("Auto-stream");
    const hint = document.getElementById(sw().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Automatically stream sats");
  });

  it("turns auto-streaming on, from the switch and from its label", () => {
    render(<V4VSettings />);
    fireEvent.click(sw());
    expect(useV4VStore.getState().autoEnabled).toBe(true);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Auto-stream"));
    expect(useV4VStore.getState().autoEnabled).toBe(false);
  });

  it("stays off when the limits are not set", () => {
    useV4VStore.setState({ perEpisodeCap: 0 });
    render(<V4VSettings />);
    fireEvent.click(sw());
    expect(useV4VStore.getState().autoEnabled).toBe(false);
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });
});
