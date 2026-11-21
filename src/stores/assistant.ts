import { create } from "zustand";
import {
  readAssistantSettings,
  writeAssistantSettings,
  type AssistantSettings,
} from "../lib/assistant/settings";

/**
 * The assistant's settings, for the components that show or change them. Saved through
 * `writeAssistantSettings`, which is also what the publish path reads (`assistantEnabled`), so the
 * two cannot disagree.
 */
interface AssistantState {
  settings: AssistantSettings;
  update: (change: Partial<AssistantSettings>) => void;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  settings: readAssistantSettings(),
  update: (change) => {
    const settings = { ...get().settings, ...change };
    writeAssistantSettings(settings);
    set({ settings });
  },
}));
