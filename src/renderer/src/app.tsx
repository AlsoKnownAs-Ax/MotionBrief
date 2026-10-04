import type { ComponentType } from "react";
import { LoginExpiryBanner } from "@renderer/claude/login-expiry-banner";
import { SettingsDialog } from "@renderer/components/settings-dialog";
import { ExportControl } from "@renderer/editor/export-control";
import { ShortcutsDialog } from "@renderer/components/shortcuts-dialog";
import { TitleBar } from "@renderer/components/title-bar";
import { useNavigation, type Screen } from "@renderer/navigation";
import { Editor, EditorToolbar } from "@renderer/screens/editor";
import { Home } from "@renderer/screens/home";
import { NewProject } from "@renderer/screens/new-project";
import { Setup } from "@renderer/screens/setup";
import { useStartTranscriptionModel } from "@renderer/setup/transcription-model-step";
import { UpdateBanner } from "@renderer/updates/update-banner";

/** Each screen, and what it adds to the title bar: a toolbar after the brand and actions on the right. */
const SCREENS = {
  home: { Screen: Home },
  setup: { Screen: Setup },
  "new-project": { Screen: NewProject },
  editor: { Screen: Editor, Toolbar: EditorToolbar, Actions: ExportControl },
} satisfies Record<Screen, { Screen: ComponentType; Toolbar?: ComponentType; Actions?: ComponentType }>;

export function App() {
  useStartTranscriptionModel();
  const screen = useNavigation((state) => state.screen);
  const { Screen, Toolbar, Actions } = { Toolbar: undefined, Actions: undefined, ...SCREENS[screen] };

  return (
    <div className="flex h-full flex-col">
      <TitleBar actions={Actions && <Actions />}>{Toolbar && <Toolbar />}</TitleBar>
      <LoginExpiryBanner />
      <UpdateBanner />
      <Screen />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
