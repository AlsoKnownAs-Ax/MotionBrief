/** Characters Windows or macOS forbid in a folder name. Control characters are forbidden too. */
const FORBIDDEN = new Set(['<', '>', ':', '"', "/", "\\", "|", "?", "*"]);

/** Names Windows reserves for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

const MAX_LENGTH = 120;

const FALLBACK_NAME = "Untitled";

/** A Project name, which is also its folder name, if it can be one on every platform MotionBrief runs on. */
export function validName(name: string): string | undefined {
  const trimmed = name.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH || [...trimmed].some(isForbidden) || RESERVED.test(trimmed)) {
    return undefined;
  }

  // Windows drops trailing dots, so "Intro." would quietly become "Intro".
  if (trimmed.endsWith(".")) {
    return undefined;
  }

  return trimmed;
}

/** A name made from a Voiceover's file name: what can't be in a folder name becomes a space. */
export function nameFromFile(stem: string): string {
  const cleaned = [...stem]
    .map(folderSafe)
    .join("")
    .replace(/\s+/g, " ")
    .slice(0, MAX_LENGTH)
    .replace(/[.\s]+$/, "")
    .trim();

  return validName(cleaned) ?? FALLBACK_NAME;
}

/** "Intro", then "Intro 2", "Intro 3"…: the names to try when a folder is taken. */
export function candidateName(name: string, attempt: number) {
  if (attempt === 1) {
    return name;
  }

  return `${name} ${attempt}`;
}

function folderSafe(character: string) {
  if (isForbidden(character)) {
    return " ";
  }

  return character;
}

function isForbidden(character: string) {
  return FORBIDDEN.has(character) || character.charCodeAt(0) < 0x20;
}
