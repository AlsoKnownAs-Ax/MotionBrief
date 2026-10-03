import { ShortcutsDialog } from "@renderer/components/shortcuts-dialog";
import { TitleBar } from "@renderer/components/title-bar";
import { Home } from "@renderer/screens/home";

export function App() {
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Home />
      <ShortcutsDialog />
    </div>
  );
}
