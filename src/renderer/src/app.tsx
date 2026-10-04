import { LoginExpiryBanner } from "@renderer/claude/login-expiry-banner";
import { SettingsDialog } from "@renderer/components/settings-dialog";
import { ShortcutsDialog } from "@renderer/components/shortcuts-dialog";
import { TitleBar } from "@renderer/components/title-bar";
import { useNavigation, type Screen } from "@renderer/navigation";
import { Home } from "@renderer/screens/home";
import { Setup } from "@renderer/screens/setup";

const SCREENS = {
  home: Home,
  setup: Setup,
} satisfies Record<Screen, () => React.JSX.Element>;

export function App() {
  const screen = useNavigation((state) => state.screen);
  const Screen = SCREENS[screen];

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <LoginExpiryBanner />
      <Screen />
      <SettingsDialog />
      <ShortcutsDialog />
    </div>
  );
}
