import type { Format } from "../../contract";
import { elementsOf, type Scene, type SceneElement } from "../storyboard";
import { FRAME_SIZES } from "./formats";
import type { UnitCode, UnitTiming } from "./page";

/**
 * The fallback Scene: plain, word-anchored kinetic typography of each Scene's structured content in
 * the Preset's tokens. Every Storyboard element appears as a line with its DOM id, revealed on its
 * word, so a unit whose Scene code keeps failing still keeps the contract. A Canvas lays its Scenes
 * out in frame-sized regions, side by side (on top of each other in vertical), for the camera to
 * move across; a carried element is there from the start, flown in by the frame.
 */
export function fallbackCode(scenes: Scene[], unit: UnitTiming, format: Format): UnitCode {
  const blocks = scenes.map((scene) => ({ scene, elements: elementsOf(scene) }));
  const stacks = blocks.map(
    ({ scene, elements }) =>
      `<div id="fb-${scene.id}" class="mb-safe fb-stack" style="font-size: ${sizeFor(elements.length)}">
${elements.map((element, index) => lineHtml(scene, element, index === 0)).join("\n")}
</div>`,
  );

  return {
    css: `.fb-stack { display: flex; flex-flow: column wrap; justify-content: center; align-content: center; gap: 24px 64px; }
.fb-line { max-width: 100%; color: var(--ink); }
.fb-code { padding: 28px 36px; margin: 0; white-space: pre; line-height: 1.4; }
.fb-world, .fb-region { position: absolute; left: 0; top: 0; }`,
    html: scenes.length > 1 ? canvasHtml(unit.id, scenes, stacks, format) : stacks.join("\n"),
    js: blocks
      .flatMap(({ scene, elements }) => elements.map(({ id }) => `${scene.id}-${id}`))
      .filter((domId) => domId !== unit.carryIn?.target)
      .map((domId) => `MB.reveal(tl, "#${domId}", at("${domId}"), "fade");`)
      .join("\n"),
  };
}

/** The Canvas: a world of frame-sized regions, one per Scene, in reading order for the Format. */
function canvasHtml(unitId: string, scenes: Scene[], stacks: string[], format: Format): string {
  const { width, height } = FRAME_SIZES[format];
  const across = format === "horizontal";
  const regions = scenes.map(
    (scene, index) =>
      `<div class="fb-region" data-region="${scene.id}" style="left: ${across ? index * width : 0}px; top: ${across ? 0 : index * height}px; width: ${width}px; height: ${height}px">
${stacks[index]}
</div>`,
  );

  return `<div id="${unitId}-world" class="fb-world" style="width: ${across ? scenes.length * width : width}px; height: ${across ? height : scenes.length * height}px">
${regions.join("\n")}
</div>`;
}

/** Fewer, larger lines when a Scene has few elements; a diagram's many labels wrap into columns. */
function sizeFor(count: number): string {
  if (count <= 5) {
    return "var(--fs-body)";
  }

  if (count <= 10) {
    return "var(--fs-label)";
  }

  return "calc(var(--fs-label) * 0.8)";
}

/** The Scene's first element leads, as a title in the Preset's display face. */
function lineHtml(scene: Scene, element: SceneElement, leads: boolean): string {
  const id = `${scene.id}-${element.id}`;
  const lines = element.value.lines;

  if (Array.isArray(lines) && lines.every((line) => typeof line === "string")) {
    return `<pre id="${id}" class="mb-card mb-mono fb-code">${escape(lines.join("\n"))}</pre>`;
  }

  return `<div id="${id}" class="${leads ? "mb-title fb-line" : "fb-line"}">${escape(textOf(scene, element.value))}</div>`;
}

/** The words an element shows: its own copy, or what its fields describe. */
function textOf(scene: Scene, value: Record<string, unknown>): string {
  const copy = [value.text, value.label, value.title, value.note].find((field) => typeof field === "string");

  if (typeof value.value === "number") {
    return [`${value.prefix ?? ""}${value.value}${value.unit ?? ""}`, copy].filter(Boolean).join(" ");
  }

  if (typeof copy === "string") {
    return copy;
  }

  if (typeof value.from === "string" && typeof value.to === "string") {
    return `${labelOf(scene, value.from)} → ${labelOf(scene, value.to)}`;
  }

  if (Array.isArray(value.lines)) {
    return `Line ${value.lines.join(", ")}`;
  }

  return String(value.id);
}

function labelOf(scene: Scene, id: string): string {
  const element = elementsOf(scene).find((candidate) => candidate.id === id);
  const label = element?.value.label;

  if (typeof label !== "string") {
    return id;
  }

  return label;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ENTITIES[char as keyof typeof ENTITIES]);
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
