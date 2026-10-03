/// <reference types="vite/client" />
import type { Bridge } from "../../preload/bridge";

declare global {
  // Declaration merging onto the DOM's Window needs an interface.
  interface Window {
    motionbrief: Bridge;
  }
}
