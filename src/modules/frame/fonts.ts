import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FontFamily, Typography } from "../../contract";

const require = createRequire(import.meta.url);

type BundledFont = {
  /** The @fontsource package's file prefix. */
  slug: string;
  package: string;
  weights: number[];
};

/** The OFL fonts the frame ships, each in every script subset its package has, so any language renders offline. */
const BUNDLED_FONTS = {
  Inter: { slug: "inter", package: "@fontsource/inter", weights: [400, 600, 700, 800] },
  "JetBrains Mono": { slug: "jetbrains-mono", package: "@fontsource/jetbrains-mono", weights: [400, 700] },
  Manrope: { slug: "manrope", package: "@fontsource/manrope", weights: [400, 600, 700, 800] },
  "IBM Plex Mono": { slug: "ibm-plex-mono", package: "@fontsource/ibm-plex-mono", weights: [400, 500, 700] },
  Fredoka: { slug: "fredoka", package: "@fontsource/fredoka", weights: [400, 600, 700] },
  Nunito: { slug: "nunito", package: "@fontsource/nunito", weights: [400, 700, 800] },
  VT323: { slug: "vt323", package: "@fontsource/vt323", weights: [400] },
} satisfies Record<FontFamily, BundledFont>;

/** The weights the frame ships for a family; a face in another weight would be synthesized by the browser. */
export function bundledWeights(family: FontFamily): number[] {
  return [...BUNDLED_FONTS[family].weights];
}

/** A file the page needs, copied from `from` to `path` relative to the page. */
export type FontFile = { path: string; from: string };

export type BundledFonts = { files: FontFile[]; css: string };

/** `@font-face` rules for the families a typography uses, and the files they load from `assets/fonts/`. */
export async function bundledFonts(typography: Typography): Promise<BundledFonts> {
  const families = [...new Set([typography.display, typography.body, typography.label, typography.mono].map(({ family }) => family))];
  const fonts = await Promise.all(
    families.map(async (family) => {
      const font = BUNDLED_FONTS[family];

      return { family, font, subsets: await subsetsOf(font) };
    }),
  );
  const faces = fonts.flatMap(({ family, font, subsets }) =>
    font.weights.flatMap((weight) =>
      Object.entries(subsets).map(([subset, range]) => ({
        family,
        weight,
        range,
        file: `${font.slug}-${subset}-${weight}-normal.woff2`,
        dir: packageDir(font),
      })),
    ),
  );

  return {
    files: faces.map(({ file, dir }) => ({ path: `assets/fonts/${file}`, from: join(dir, "files", file) })),
    css: faces
      .map(
        ({ family, weight, range, file }) =>
          `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: block; src: url("assets/fonts/${file}") format("woff2"); unicode-range: ${range}; }`,
      )
      .join("\n"),
  };
}

/** Script subset → unicode-range, as the package publishes them. */
async function subsetsOf(font: BundledFont): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(packageDir(font), "unicode.json"), "utf8"));
}

/** The package exports only its CSS and files, so it is found through a file every weight ships. */
function packageDir(font: BundledFont): string {
  return dirname(dirname(require.resolve(`${font.package}/files/${font.slug}-latin-400-normal.woff2`)));
}
