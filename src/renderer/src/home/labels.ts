const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayInYear = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today, 15:27", "Yesterday, 21:04", "Sep 28", or "Sep 28, 2025" for earlier years. */
export function modifiedLabel(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (at >= today.getTime()) {
    return `Today, ${time.format(date)}`;
  }

  if (at >= today.getTime() - DAY_MS) {
    return `Yesterday, ${time.format(date)}`;
  }

  if (date.getFullYear() === today.getFullYear()) {
    return dayInYear.format(date);
  }

  return fullDate.format(date);
}

/** "since 15:27", "since yesterday, 21:04", "since Sep 28". */
export function sinceLabel(at: number, now = Date.now()) {
  const label = modifiedLabel(at, now);

  if (label.startsWith("Today, ")) {
    return `since ${label.slice("Today, ".length)}`;
  }

  if (label.startsWith("Yesterday")) {
    return `since y${label.slice(1)}`;
  }

  return `since ${label}`;
}

/** What the OS calls its file manager, for Show in Explorer / Finder. */
export function fileManagerName() {
  if (window.motionbrief.platform === "darwin") {
    return "Finder";
  }

  if (window.motionbrief.platform === "win32") {
    return "Explorer";
  }

  return "Files";
}

/** What the OS calls the place deleted files go. */
export function trashName() {
  if (window.motionbrief.platform === "win32") {
    return "Recycle Bin";
  }

  return "Trash";
}
