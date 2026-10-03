import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Where each icon set's SVGs ship: Lucide (ISC) and Simple Icons (CC0), bundled so icons work offline. */
const ICON_DIRS = {
  lucide: join(dirname(require.resolve("lucide-static/package.json")), "icons"),
  brand: join(dirname(require.resolve("simple-icons")), "icons"),
};

type IconSet = keyof typeof ICON_DIRS;

/** `lucide:<name>` or `brand:<simple-icons slug>`, as a Storyboard names icons. */
const ICON_NAME = /^(lucide|brand):([a-z0-9-]+)$/;

/** `<i data-icon="lucide:server" id=".." class=".."></i>`, the placeholder Scene code writes for an icon. */
const ICON_PLACEHOLDER = /<i\b([^>]*?)\sdata-icon="([^"]*)"([^>]*)>\s*<\/i>/g;

export type InlinedIcons = {
  html: string;
  /** Icon names that aren't in either bundled set; their placeholders are dropped. */
  unknownIcons: string[];
};

/**
 * Replaces every icon placeholder with the icon's inline SVG. The placeholder's id, class and
 * other attributes move to the SVG, which gets `mb-icon` (a 1em box drawn in `currentColor`).
 */
export async function inlineIcons(html: string): Promise<InlinedIcons> {
  const names = [...new Set([...html.matchAll(ICON_PLACEHOLDER)].map((match) => match[2] ?? ""))];
  const svgs = new Map(await Promise.all(names.map(async (name) => [name, await iconSvg(name)] as const)));

  return {
    html: html.replace(ICON_PLACEHOLDER, (_placeholder, before: string, name: string, after: string) => {
      const svg = svgs.get(name);

      if (!svg) {
        return "";
      }

      return withAttributes(svg, `${before} ${after}`);
    }),
    unknownIcons: names.filter((name) => !svgs.get(name)),
  };
}

/** Whether an icon name is in one of the bundled sets. */
export async function hasIcon(name: string): Promise<boolean> {
  return (await iconSvg(name)) !== undefined;
}

/** The icon's SVG with its own size and class removed, so it takes the placeholder's; `undefined` when unknown. */
async function iconSvg(name: string): Promise<string | undefined> {
  const match = ICON_NAME.exec(name);

  if (!match) {
    return undefined;
  }

  const set = match[1] as IconSet;
  const svg = await readIcon(join(ICON_DIRS[set], `${match[2]}.svg`));

  if (!svg) {
    return undefined;
  }

  // Only the root tag loses its size: inner shapes such as Lucide's <rect width=..> keep theirs.
  const bare = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .replace(/^<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height|class)="[^"]*"/g, ""));

  if (set === "brand") {
    return bare.replace("<svg", '<svg fill="currentColor"');
  }

  return bare;
}

async function readIcon(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Puts the placeholder's attributes on the SVG root, joining its classes with `mb-icon`. */
function withAttributes(svg: string, attributes: string): string {
  const classes = /\bclass="([^"]*)"/.exec(attributes)?.[1] ?? "";
  const others = attributes.replace(/\bclass="[^"]*"/, "").replace(/\s+/g, " ").trim();
  const opening = ["<svg", `class="${`mb-icon ${classes}`.trim()}"`, others].filter(Boolean).join(" ");

  return svg.replace("<svg", opening);
}
