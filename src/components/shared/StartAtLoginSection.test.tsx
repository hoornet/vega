import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// "Start Vega when I log in": the switch shows what the system holds, read when Settings opens
// and after every change, and says why when this build cannot write a login entry.

const autostart = vi.hoisted(() => ({
  readAutostart: vi.fn(),
  setAutostart: vi.fn(),
}));
vi.mock("../../lib/autostart", () => autostart);

import { StartAtLoginSection } from "./StartAtLoginSection";

const toggle = () => screen.getByRole("switch", { name: "Start Vega when I log in" });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  autostart.readAutostart.mockReset();
  autostart.setAutostart.mockReset();
});
afterEach(cleanup);

describe("Start Vega when I log in", () => {
  it("shows the login entry as the system holds it, and says what it does", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: true, unavailable: null });
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
    expect(toggle().getAttribute("aria-busy")).not.toBe("true");
    expect(toggle().hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/starts in the tray, with no window/)).toBeTruthy();
  });

  it("is busy, not off, until the entry has been read", async () => {
    const read = deferred<{ enabled: boolean; unavailable: null }>();
    autostart.readAutostart.mockReturnValue(read.promise);
    render(<StartAtLoginSection />);
    expect(toggle().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(toggle());
    expect(autostart.setAutostart).not.toHaveBeenCalled();
    await act(async () => read.resolve({ enabled: false, unavailable: null }));
    expect(toggle().getAttribute("aria-busy")).not.toBe("true");
  });

  it("writes the entry and shows what the system says afterwards", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: false, unavailable: null });
    const write = deferred<boolean>();
    autostart.setAutostart.mockReturnValue(write.promise);
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().getAttribute("aria-busy")).not.toBe("true"));
    fireEvent.click(toggle());
    expect(autostart.setAutostart).toHaveBeenCalledWith(true);
    // Busy while it is written, keeping focus (not disabled), and a second press does nothing.
    expect(toggle().getAttribute("aria-busy")).toBe("true");
    expect(toggle().hasAttribute("disabled")).toBe(false);
    fireEvent.click(toggle());
    expect(autostart.setAutostart).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve(true));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("shows off when the system says the entry is not there, whatever was pressed", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: false, unavailable: null });
    autostart.setAutostart.mockResolvedValue(false);
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().getAttribute("aria-busy")).not.toBe("true"));
    fireEvent.click(toggle());
    await waitFor(() => expect(autostart.setAutostart).toHaveBeenCalled());
    await waitFor(() => expect(toggle().getAttribute("aria-busy")).not.toBe("true"));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("removes the entry", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: true, unavailable: null });
    autostart.setAutostart.mockResolvedValue(false);
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(toggle());
    expect(autostart.setAutostart).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("false"));
  });

  it("says when the entry could not be written, and keeps showing the truth", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: false, unavailable: null });
    autostart.setAutostart.mockRejectedValue("Permission denied (os error 13)");
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().getAttribute("aria-busy")).not.toBe("true"));
    fireEvent.click(toggle());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Couldn't add Vega to the programs that start when you log in: Permission denied (os error 13).",
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("is off and says why in a development build", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: false, unavailable: "development" });
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/Not in a development build/)).toBeTruthy();
    fireEvent.click(toggle());
    expect(autostart.setAutostart).not.toHaveBeenCalled();
  });

  it("is off and says why in the Flatpak", async () => {
    autostart.readAutostart.mockResolvedValue({ enabled: false, unavailable: "flatpak" });
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/Not in the Flatpak yet/)).toBeTruthy();
  });

  it("says so when the entry could not be read, and offers nothing to press", async () => {
    autostart.readAutostart.mockRejectedValue("no home directory");
    render(<StartAtLoginSection />);
    await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(true));
    expect(screen.getByText("Couldn't tell whether Vega starts when you log in: no home directory.")).toBeTruthy();
    expect(toggle().getAttribute("aria-busy")).not.toBe("true");
  });
});
