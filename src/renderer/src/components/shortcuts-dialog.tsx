import { useEffect, useState } from "react";
import { ShortcutKeys } from "@renderer/components/shortcut-keys";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { SHORTCUTS } from "../../../shared/shortcuts";

/** Lists the app's keyboard shortcuts; opened from Help › Keyboard Shortcuts. */
export function ShortcutsDialog() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(
    () =>
      window.motionbrief.onCommand((command) => {
        if (command === "shortcuts.show") {
          setIsOpen(true);
        }
      }),
    [],
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Also listed next to each command in the app menu.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col">
          {Object.values(SHORTCUTS).map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex h-9 items-center justify-between border-b border-hairline-soft last:border-0"
            >
              <dt className="text-app-sm">{shortcut.label}</dt>
              <dd>
                <ShortcutKeys shortcut={shortcut} />
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
