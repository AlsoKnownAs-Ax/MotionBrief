// PROTOTYPE: token-only lint (amended ADR 0003) — Scene code may use Palette/typography tokens only:
// no raw colors (hex, rgb/hsl/oklch/..., named colors) and no font families other than var(--font-*).
import type { UnitCode } from "./frame.ts";

const NAMED = "white|black|red|green|blue|yellow|orange|purple|violet|pink|magenta|cyan|aqua|teal|navy|gray|grey|silver|gold|lime|olive|maroon|brown|indigo|crimson|coral|salmon|tomato|khaki|beige|ivory|lavender|turquoise|skyblue|royalblue|dodgerblue|steelblue|slategray|darkgray|lightgray|whitesmoke|gainsboro";
const COLOR_PROPS = "color|background|background-color|background-image|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|text-shadow|fill|stroke|stop-color|filter|caret-color|text-decoration-color|column-rule|backgroundColor|borderColor|boxShadow|textShadow|outlineColor|stopColor";

export function tokenLint(c: UnitCode): string[] {
  const out: string[] = [];
  const add = (where: string, what: string) => out.push(`${where}: raw ${what} — use the Preset tokens (var(--ink), var(--accent), color-mix(in srgb, var(--x) N%, transparent), var(--font-*))`);
  const scan = (where: string, src: string, isJs: boolean) => {
    // hex colors; ids and selectors like #s03-edge are not hex-only words
    for (const m of src.matchAll(/#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![-\w])/g)) {
      const before = src.slice(Math.max(0, m.index! - 2), m.index!);
      if (/[\w-]$/.test(before)) continue;
      add(where, `color ${m[0]}`);
    }
    for (const m of src.matchAll(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*(?!from\b)/g)) add(where, `color function ${m[1]}()`);
    // named colors only in color-bearing positions
    const decl = new RegExp(`(?:\\b(?:${COLOR_PROPS})\\s*[:=]\\s*)(["']?)([^;"'}\\n]*)`, "g");
    for (const m of src.matchAll(decl)) {
      const v = m[2].replace(/var\([^)]*\)/g, "");
      const n = v.match(new RegExp(`\\b(${NAMED})\\b`, "i"));
      if (n) add(where, `color name "${n[1]}"`);
    }
    // fonts
    for (const m of src.matchAll(/font-family\s*:\s*([^;"}\n]+)/g)) if (!/^\s*(var\(--font-[a-z]+\)|inherit)\s*!?\w*\s*$/.test(m[1])) add(where, `font-family "${m[1].trim()}"`);
    for (const m of src.matchAll(/\bfont\s*:\s*([^;"}\n]+)/g)) if (!/var\(--font-/.test(m[1])) add(where, `font shorthand "${m[1].trim()}"`);
    if (isJs) for (const m of src.matchAll(/fontFamily\s*:\s*["'`]([^"'`]+)/g)) if (!/^var\(--font-/.test(m[1])) add(where, `fontFamily "${m[1]}"`);
  };
  scan("css", c.css, false);
  // only attribute values of the html (text content may say "green" legitimately)
  for (const m of c.html.matchAll(/\b(style|fill|stroke|stop-color|color)\s*=\s*"([^"]*)"/g)) scan("html", m[1] === "style" ? m[2] : `${m[1]}: ${m[2]}`, false);
  scan("js", c.js, true);
  return [...new Set(out)];
}
