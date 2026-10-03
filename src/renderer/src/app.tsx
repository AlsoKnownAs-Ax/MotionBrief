import type { ComponentType } from "react";
import { ShortcutsDialog } from "@renderer/components/shortcuts-dialog";
import { TitleBar } from "@renderer/components/title-bar";
import { Home } from "@renderer/screens/home";
import { useScreen, type Screen } from "@renderer/screens/navigation";
import { Setup } from "@renderer/screens/setup";
import { useStartTranscriptionModel } from "@renderer/setup/transcription-model-step";

const SCREENS = {
  setup: Setup,
  home: Home,
} satisfies Record<Screen, ComponentType>;

export function App() {
  useStartTranscriptionModel();
  const screen = useScreen((state) => state.screen);
  const Screen = SCREENS[screen];

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Screen />
      <ShortcutsDialog />
    </div>
  );
}
