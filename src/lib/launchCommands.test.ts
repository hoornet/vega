import { describe, it, expect, vi, beforeEach } from "vitest";

// Rust's side, played here: a queue the frontend drains, and the event that says it filled.
const tauri = vi.hoisted(() => ({
  queue: [] as string[],
  handlers: [] as Array<() => void>,
  listenFails: false,
  unlistened: 0,
  release: null as null | (() => void),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd !== "take_launch_commands") throw new Error(`unexpected ${cmd}`);
    return tauri.queue.splice(0);
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: () => void) => {
    if (tauri.listenFails) return Promise.reject(new Error("no event bridge"));
    return new Promise<() => void>((resolve) => {
      tauri.release = () => {
        tauri.handlers.push(handler);
        resolve(() => { tauri.unlistened++; tauri.handlers = tauri.handlers.filter((h) => h !== handler); });
      };
    });
  }),
}));

import { listenForLaunchCommands, runLaunchCommand } from "./launchCommands";
import { useUIStore } from "../stores/ui";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const arrive = (command: string) => { tauri.queue.push(command); for (const h of tauri.handlers) h(); };

beforeEach(() => {
  tauri.queue = [];
  tauri.handlers = [];
  tauri.listenFails = false;
  tauri.unlistened = 0;
  tauri.release = null;
});

describe("listenForLaunchCommands", () => {
  it("runs what this launch's own command line asked for", async () => {
    tauri.queue.push("compose");
    const run = vi.fn();
    listenForLaunchCommands(run);
    await settle();
    expect(run).toHaveBeenCalledWith("compose");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("takes the queue again once listening, for a command that arrived before the listener", async () => {
    const run = vi.fn();
    listenForLaunchCommands(run);
    await settle();
    expect(run).not.toHaveBeenCalled();
    tauri.queue.push("compose"); // announced while nobody listened
    tauri.release!();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs each later launch's command as it arrives, once", async () => {
    const run = vi.fn();
    listenForLaunchCommands(run);
    tauri.release!();
    await settle();
    arrive("compose");
    await settle();
    arrive("compose");
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("still runs the start's commands where there is no event bridge", async () => {
    tauri.listenFails = true;
    tauri.queue.push("compose");
    const run = vi.fn();
    expect(() => listenForLaunchCommands(run)).not.toThrow();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops a listener that is in place", async () => {
    const run = vi.fn();
    const stop = listenForLaunchCommands(run);
    tauri.release!();
    await settle();
    stop();
    expect(tauri.unlistened).toBe(1);
    arrive("compose");
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it("stops listening, including a listener that arrives after it was stopped", async () => {
    const stop = listenForLaunchCommands(vi.fn());
    stop();
    tauri.release!();
    await settle();
    expect(tauri.unlistened).toBe(1);
    expect(tauri.handlers).toHaveLength(0);
  });
});

describe("runLaunchCommand", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useUIStore.setState({ currentView: "settings", viewStack: [], composeRequest: 0, composePendingUntil: 0 });
  });

  it("opens the compose box on the feed, and the request waits for a box that is not there yet", () => {
    runLaunchCommand("compose");
    const s = useUIStore.getState();
    expect(s.currentView).toBe("feed");
    expect(s.composeRequest).toBe(1);
    expect(s.composePendingUntil).toBeGreaterThan(Date.now());
  });

  it("moves nothing behind an open dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    try {
      runLaunchCommand("compose");
      const s = useUIStore.getState();
      expect(s.currentView).toBe("settings");
      expect(s.composeRequest).toBe(0);
      expect(s.composePendingUntil).toBe(0);
    } finally {
      dialog.remove();
    }
  });
});
