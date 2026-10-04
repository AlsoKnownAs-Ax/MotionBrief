import type { Format } from "../../../contract";

/** m:ss, or h:mm:ss from an hour. */
export function clockLabel(seconds: number) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
  }

  return `${minutes}:${rest}`;
}

export function sizeLabel(bytes: number) {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }

  return `${Math.max(0.1, bytes / 1_000_000).toFixed(1)} MB`;
}

export const FORMAT_OPTIONS = [
  { value: "horizontal", ratio: "16:9", use: "YouTube" },
  { value: "vertical", ratio: "9:16", use: "Shorts" },
] satisfies { value: Format; ratio: string; use: string }[];

/** Languages offered by name; Whisper knows about a hundred, and these cover most creators. */
export const LANGUAGES = ["en", "es", "pt", "fr", "de", "it", "nl", "pl", "ro", "sv", "tr", "ru", "uk", "ar", "hi", "ja", "ko", "zh"];

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function languageName(code: string) {
  return languageNames.of(code) ?? code;
}
