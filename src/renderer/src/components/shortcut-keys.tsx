import { Kbd, KbdGroup } from "@renderer/components/ui/kbd";
import { shortcutKeys, type Shortcut } from "../../../shared/shortcuts";

const { platform } = window.motionbrief;

/** A shortcut's keys as this platform writes them, e.g. Ctrl + / or ⌘ /. */
export function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <KbdGroup>
      {shortcutKeys(shortcut, platform).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
