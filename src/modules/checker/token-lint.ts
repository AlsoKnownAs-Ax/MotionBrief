import type { CheckFinding } from "../../contract";
import type { UnitCode } from "../frame";

/** Color names CSS knows that agents reach for; `transparent`, `currentColor` and `inherit` stay allowed. */
const NAMED_COLORS =
  "white|black|red|green|blue|yellow|orange|purple|violet|pink|magenta|fuchsia|cyan|aqua|teal|navy|gray|grey|silver|gold|lime|olive|maroon|brown|indigo|crimson|coral|salmon|tomato|khaki|beige|ivory|lavender|turquoise|skyblue|royalblue|dodgerblue|steelblue|slategray|slategrey|darkgray|darkgrey|lightgray|lightgrey|whitesmoke|gainsboro";

/** Properties, CSS or GSAP's camelCase, whose value can hold a color. */
const COLOR_PROPERTIES =
  "color|background|background-color|background-image|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|text-shadow|fill|stroke|stop-color|filter|caret-color|text-decoration-color|column-rule|accent-color|backgroundColor|backgroundImage|borderColor|boxShadow|textShadow|outlineColor|stopColor|caretColor";

const HEX_COLOR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![-\w])/g;
const COLOR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!from\b)/g;
const COLOR_DECLARATION = new RegExp(`\\b(?:${COLOR_PROPERTIES})\\s*[:=]\\s*["'\`]?([^;"'\`}\\n]*)`, "g");
const NAMED_COLOR = new RegExp(`\\b(${NAMED_COLORS})\\b`, "i");
const FONT_FAMILY = /font-family\s*:\s*([^;"}\n]+)/g;
const FRAME_FONT = /^\s*(var\(--font-(display|body|label|mono)\)|inherit)\s*(!important)?\s*$/;
const FONT_SHORTHAND = /(?<![-\w])font\s*:\s*([^;"}\n]+)/g;
const JS_FONT_FAMILY = /fontFamily\s*:\s*["'`]([^"'`]+)/g;
const HTML_COLOR_ATTRIBUTE = /\b(style|fill|stroke|stop-color|color)\s*=\s*"([^"]*)"/g;

const FIX = "Use the frame's tokens: var(--ink), var(--accent) and the other Palette roles, color-mix(in srgb, var(--accent) 20%, transparent) for tints, and var(--font-display|body|label|mono).";

/**
 * Scene code may only use the frame's tokens for color and type (ADR 0003), so a Palette or
 * typography swap is a re-render. Rejects raw colors (hex, color functions, color names) and any
 * font other than the frame's `var(--font-*)`.
 */
export function tokenLint(unit: string, code: UnitCode): CheckFinding[] {
  const htmlAttributes = [...code.html.matchAll(HTML_COLOR_ATTRIBUTE)].map(([, name, value]) => {
    if (name === "style") {
      return value ?? "";
    }

    return `${name}: ${value}`;
  });
  const problems = [
    ...scan("css", stripSelectors(code.css)),
    ...htmlAttributes.flatMap((attribute) => scan("html", attribute)),
    ...scan("js", code.js),
    ...[...code.js.matchAll(JS_FONT_FAMILY)]
      .filter(([, family]) => !FRAME_FONT.test(family ?? ""))
      .map(([, family]) => ({ code: "FOREIGN_FONT", where: "js", what: `fontFamily "${family}"` })),
  ];
  const unique = [...new Map(problems.map((problem) => [`${problem.code} ${problem.where} ${problem.what}`, problem])).values()];

  return unique.map(({ code: findingCode, where, what }) => ({
    unit,
    source: "tokens",
    code: findingCode,
    message: `Raw ${what} in the ${where}. ${FIX}`,
  }));
}

type Problem = { code: "RAW_COLOR" | "FOREIGN_FONT"; where: "css" | "html" | "js"; what: string };

function scan(where: Problem["where"], source: string): Problem[] {
  const hex = [...source.matchAll(HEX_COLOR)]
    .filter((match) => !/[\w-]$/.test(source.slice(0, match.index)))
    .map(([color]) => ({ code: "RAW_COLOR" as const, where, what: `color ${color}` }));
  const functions = [...source.matchAll(COLOR_FUNCTION)].map(([, name]) => ({
    code: "RAW_COLOR" as const,
    where,
    what: `color function ${name}()`,
  }));
  const named = [...source.matchAll(COLOR_DECLARATION)]
    .map(([, value]) => NAMED_COLOR.exec((value ?? "").replace(/var\([^)]*\)/g, ""))?.[1])
    .filter((name) => name !== undefined)
    .map((name) => ({ code: "RAW_COLOR" as const, where, what: `color name "${name}"` }));
  const families = [...source.matchAll(FONT_FAMILY)]
    .filter(([, family]) => !FRAME_FONT.test(family ?? ""))
    .map(([, family]) => ({ code: "FOREIGN_FONT" as const, where, what: `font-family "${family?.trim()}"` }));
  const shorthands = [...source.matchAll(FONT_SHORTHAND)]
    .filter(([, value]) => !/var\(--font-(display|body|label|mono)\)/.test(value ?? ""))
    .map(([, value]) => ({ code: "FOREIGN_FONT" as const, where, what: `font shorthand "${value?.trim()}"` }));

  return [...hex, ...functions, ...named, ...families, ...shorthands];
}

/** CSS without its selectors, so an id such as `#bad` or `#s01-add` is never read as a color. */
function stripSelectors(css: string): string {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map(([, body]) => body).join("\n");
}
