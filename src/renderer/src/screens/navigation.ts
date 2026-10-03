import { create } from "zustand";

export type Screen = "setup" | "home";

/** Set once the user leaves the setup screen; until then every launch opens on it. */
const SETUP_LEFT_KEY = "motionbrief.setup-left";

export const useScreen = create<{ screen: Screen }>(() => ({ screen: firstScreen() }));

function firstScreen(): Screen {
  if (localStorage.getItem(SETUP_LEFT_KEY)) {
    return "home";
  }

  return "setup";
}

export function openSetup() {
  useScreen.setState({ screen: "setup" });
}

/** Setup never blocks: leaving it is always allowed, and Home lists what's unfinished. */
export function leaveSetup() {
  localStorage.setItem(SETUP_LEFT_KEY, "true");
  useScreen.setState({ screen: "home" });
}
