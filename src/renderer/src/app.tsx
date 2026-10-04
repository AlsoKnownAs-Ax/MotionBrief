import type { ComponentType } from "react";
import { LoginExpiryBanner } from "@renderer/claude/login-expiry-banner";
import { SettingsDialog } from "@renderer/components/settings-dialog";
import { ShortcutsDialog } from "@renderer/components/shortcuts-dialog";
import { TitleBar } from "@renderer/components/title-bar";
import { useNavigation, type Screen } from "@renderer/navigation";
import { Editor, EditorToolbar } from "@renderer/screens/editor";
import { Home } from "@renderer/screens/home";
import { Setup } from "@renderer/screens/setup";
import { useStartTranscriptionModel } from "@renderer/setup/transcription-model-step";

/** Each screen, and what it adds to the title bar. */
const SCREENS = {
  home: { Screen: Home },
  setup: { Screen: Setup },
  editor: { Screen: Editor, Toolbar: EditorToolbar },
} satisfies Record<Screen, { Screen: ComponentType; Toolbar?: ComponentType }>;

export function App() {
  useStartTranscriptionModel();
  const screen = useNavigation((state) => state.screen);
  const { Screen, Toolbar } = { Toolbar: undefined, ...SCREENS[screen] };

  return (
    <div className="flex h-full flex-col">
      <TitleBar>{Toolbar && <Toolbar />}</TitleBar>
      <LoginExpiryBanner />
      <Screen />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
