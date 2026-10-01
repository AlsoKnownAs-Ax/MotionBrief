import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Kbd, KbdGroup } from "@renderer/components/ui/kbd";
import { acceleratorFor, acceleratorKeys, SHORTCUTS } from "../../../shared/shortcuts";

const { platform } = window.motionbrief;

const ROWS = Object.values(SHORTCUTS).map((shortcut) => ({
  label: shortcut.label,
  keys: acceleratorKeys(acceleratorFor(shortcut, platform), platform),
}));

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
          {ROWS.map(({ label, keys }) => (
            <div key={label} className="flex h-9 items-center justify-between border-b border-hairline-soft last:border-0">
              <dt className="text-app-sm">{label}</dt>
              <dd>
                <KbdGroup>
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
