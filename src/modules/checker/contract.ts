import type { CheckFinding } from "../../contract";
import type { AssembledPage, Unit } from "../assembler";
import { elementsOf } from "../storyboard";
import type { FramePage } from "./page";

/** An element is clearly arriving this long after its word starts, and not yet visible this long before (ADR 0003). */
const ARRIVE_BY = 0.1;
const HIDDEN_BEFORE = 0.3;

/** How late a late element is, searched at these offsets after its word, for the message. */
const LATENESS = [0.25, 0.5, 1, 2];

type Probe = {
  count: number;
  opacity?: number;
  drawn?: number;
  inFrame?: boolean;
  visible?: boolean;
  handDrawnLines?: number;
};

/** One Storyboard element to probe: its DOM id, the absolute time of its word, and whether it is a connector. */
type Anchor = { unit: Unit; domId: string; local: number; time: number; isConnector: boolean };

/**
 * The anchor contract: every Storyboard element exists once in the page as `<sceneId>-<elementId>`,
 * is clearly arriving (effective opacity ≥ 0.3, or ≥ 30% drawn for a connector) by its word + 0.1 s,
 * and is hidden before its word − 0.3 s. Connectors are laid out by MB.connect, never by hand.
 */
export async function checkContract(page: FramePage, assembled: AssembledPage): Promise<CheckFinding[]> {
  const anchors = assembled.units.flatMap((unit) => anchorsOf(unit));
  const findings: CheckFinding[] = [];

  for (const anchor of anchors) {
    findings.push(...(await checkAnchor(page, assembled, anchor)));
  }

  return findings;
}

function anchorsOf(unit: Unit): Anchor[] {
  return unit.scenes.flatMap((scene) =>
    elementsOf(scene).map(({ id, field }) => {
      const domId = `${scene.id}-${id}`;
      const local = unit.anchors[domId] ?? 0;

      return { unit, domId, local, time: unit.start + local, isConnector: field.startsWith("content.edges[") };
    }),
  );
}

async function checkAnchor(page: FramePage, assembled: AssembledPage, anchor: Anchor): Promise<CheckFinding[]> {
  const { unit, domId, local, time } = anchor;
  const finding = (code: string, message: string, at: number): CheckFinding => ({
    unit: unit.id,
    source: "contract",
    code,
    message,
    selector: `#${domId}`,
    time: round(at),
  });
  const before = Math.max(0, time - HIDDEN_BEFORE);
  const early = await probeAt(page, assembled, domId, before);

  if (early.count === 0) {
    return [
      finding(
        "MISSING_ELEMENT",
        `#${domId} isn't in the page. Give the element for Storyboard element "${domId.slice(domId.indexOf("-") + 1)}" the DOM id ${domId}.`,
        time,
      ),
    ];
  }

  const arriving = await probeAt(page, assembled, domId, time + ARRIVE_BY);
  const findings: CheckFinding[] = [];

  if (early.count > 1) {
    findings.push(finding("DUPLICATE_ELEMENT_ID", `${early.count} elements have the id ${domId}; DOM ids are unique across the page.`, time));
  }

  // An element on one of the unit's first words may already show when the unit starts.
  if (early.visible && before > unit.start + 0.05) {
    findings.push(
      finding(
        "EARLY",
        `#${domId} is already visible ${HIDDEN_BEFORE} s before its word (at(${quote(domId)}) = ${local} s). Reveal it on its word: MB.reveal(tl, "#${domId}", at(${quote(domId)})).`,
        before,
      ),
    );
  }

  if (!arriving.visible) {
    findings.push(finding("LATE", await lateMessage(page, assembled, anchor, arriving), time + ARRIVE_BY));
  }

  if (anchor.isConnector && (arriving.handDrawnLines ?? 0) > 0) {
    findings.push(
      finding(
        "HAND_DRAWN_CONNECTOR",
        `#${domId} draws a line that MB.connect didn't lay out. Draw connectors with MB.connect(path, from, to), then MB.draw.`,
        time,
      ),
    );
  }

  return findings;
}

async function lateMessage(page: FramePage, assembled: AssembledPage, { domId, local, time }: Anchor, arriving: Probe): Promise<string> {
  const rule = `It must be clearly arriving (opacity ≥ 0.3 inside the frame, or a connector ≥ 30% drawn) by ${ARRIVE_BY} s after its word (at(${quote(domId)}) = ${local} s).`;

  for (const offset of LATENESS) {
    if ((await probeAt(page, assembled, domId, time + offset)).visible) {
      return `#${domId} appears about ${offset} s after its word. ${rule}`;
    }
  }

  return `#${domId} never becomes visible after its word (${describe(arriving)}). ${rule}`;
}

function describe({ opacity, drawn, inFrame }: Probe): string {
  if (!inFrame) {
    return "it is outside the frame or has no size";
  }

  if ((drawn ?? 1) < 0.3) {
    return `it is ${Math.round((drawn ?? 0) * 100)}% drawn`;
  }

  return `its effective opacity is ${round(opacity ?? 0)}`;
}

async function probeAt(page: FramePage, { width, height }: AssembledPage, domId: string, time: number): Promise<Probe> {
  await page.seek(time);

  return page.evaluate<Probe>(`window.__mbProbe(${JSON.stringify(domId)}, ${width}, ${height})`);
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
