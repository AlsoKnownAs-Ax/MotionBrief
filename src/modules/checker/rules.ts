import type { CheckFinding } from "../../contract";
import type { AssembledPage, Unit } from "../assembler";
import type { FramePage } from "./page";

/** How often each unit is sampled, in seconds. */
const STEP = 0.25;

/** A texture overlay must stay below this opacity, or it covers the words beneath (and `hyperframes check` reports them hidden). */
const MAX_TEXTURE_OPACITY = 0.6;

type Overlap = { kind: "icon" | "image"; selector: string; text: string; textSelector: string; composition: string | null };

type Texture = { selector: string; opacity: number; composition: string | null };

type Seen = { overlaps: Overlap[]; textures: Texture[] };

/**
 * The Checker's own rules, for problems the visual review used to catch: an icon or image laid
 * over text (unless `data-layout-allow-overlap` marks it as deliberate) and a texture overlay at
 * opacity 0.6 or above. Each unit is sampled across its time on screen. An overlap must hold for two
 * samples in a row, so an icon passing over text on its way in isn't one.
 */
export async function checkRules(page: FramePage, assembled: AssembledPage): Promise<CheckFinding[]> {
  const overlaps = new Map<string, CheckFinding>();
  const textures = new Map<string, { finding: CheckFinding; opacity: number }>();

  for (const unit of assembled.units) {
    // Overlaps seen at the previous sample, with the time each was first seen.
    let running = new Map<string, number>();
    // While a unit plays, what is in it or in the page around it is checked; other units are checked in their own time.
    const isOwn = ({ composition }: { composition: string | null }) => [unit.id, undefined].includes(unitOf(composition, assembled));

    for (const time of samplesOf(unit)) {
      const seen = await seeAt(page, assembled, time);
      const now = new Map<string, number>();

      for (const overlap of seen.overlaps.filter(isOwn)) {
        const key = `${overlap.selector} ${overlap.textSelector}`;
        const since = running.get(key);

        now.set(key, since ?? time);

        if (since !== undefined && !overlaps.has(key)) {
          overlaps.set(key, overlapFinding(overlap, assembled, since));
        }
      }

      running = now;

      for (const texture of seen.textures.filter((texture) => isOwn(texture) && texture.opacity >= MAX_TEXTURE_OPACITY)) {
        const known = textures.get(texture.selector);

        if (!known || texture.opacity > known.opacity) {
          textures.set(texture.selector, { finding: textureFinding(texture, assembled, time), opacity: texture.opacity });
        }
      }
    }
  }

  return [...overlaps.values(), ...[...textures.values()].map(({ finding }) => finding)];
}

function overlapFinding({ kind, selector, text, textSelector, composition }: Overlap, assembled: AssembledPage, time: number): CheckFinding {
  return {
    unit: unitOf(composition, assembled),
    source: "rules",
    code: kind === "icon" ? "ICON_OVERLAPS_TEXT" : "IMAGE_OVERLAPS_TEXT",
    message: `The ${kind} ${selector} overlaps the text "${text}" (${textSelector}). Give each its own space, such as side by side in a flex row, or mark deliberate layering with data-layout-allow-overlap on the ${kind} or the text.`,
    selector,
    time: round(time),
  };
}

function textureFinding({ selector, opacity, composition }: Texture, assembled: AssembledPage, time: number): CheckFinding {
  return {
    unit: unitOf(composition, assembled),
    source: "rules",
    code: "TEXTURE_TOO_OPAQUE",
    message: `The texture overlay ${selector} reaches opacity ${round(opacity, 100)}. Keep texture overlays below ${MAX_TEXTURE_OPACITY}: any higher and they cover the words beneath. Lower its opacity, or leave the texture out.`,
    selector,
    time: round(time),
  };
}

/** Times across the unit's time on screen, clear of the cuts at either end. */
function samplesOf({ start, duration }: Unit): number[] {
  const times: number[] = [];

  for (let time = start + 0.1; time < start + duration - 0.05; time += STEP) {
    times.push(round(time));
  }

  return times;
}

/** The unit a composition is, or `undefined` for the page's own. */
function unitOf(composition: string | null, { units }: AssembledPage): string | undefined {
  return units.find(({ id }) => id === composition)?.id;
}

async function seeAt(page: FramePage, { width, height }: AssembledPage, time: number): Promise<Seen> {
  await page.seek(time);

  return page.evaluate<Seen>(`window.__mbRules(${width}, ${height})`);
}

function round(value: number, precision = 1000): number {
  return Math.round(value * precision) / precision;
}
