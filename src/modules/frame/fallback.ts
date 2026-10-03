import { elementsOf, type Scene, type SceneElement } from "../storyboard";
import type { UnitCode, UnitTiming } from "./page";

/**
 * The fallback Scene: plain, word-anchored kinetic typography of each Scene's structured content in
 * the Preset's tokens. Every Storyboard element appears as a line with its DOM id, revealed on its
 * word, so a unit whose Scene code keeps failing still keeps the contract. A Canvas shows its
 * Scenes one after another.
 */
export function fallbackCode(scenes: Scene[], unit: UnitTiming): UnitCode {
  const blocks = scenes.map((scene) => ({ scene, elements: elementsOf(scene) }));

  return {
    css: `.fb-stack { display: flex; flex-flow: column wrap; justify-content: center; align-content: center; gap: 24px 64px; }
.fb-line { max-width: 100%; color: var(--ink); }
.fb-line:first-child { font-family: var(--font-display); font-size: var(--fs-title); font-weight: 800; line-height: 1.08; }
.fb-code { padding: 28px 36px; margin: 0; white-space: pre; line-height: 1.4; }`,
    html: blocks
      .map(
        ({ scene, elements }) =>
          `<div id="fb-${scene.id}" class="mb-safe fb-stack" style="font-size: ${sizeFor(elements.length)}">
${elements.map((element) => lineHtml(scene, element)).join("\n")}
</div>`,
      )
      .join("\n"),
    js: blocks
      .flatMap(({ scene, elements }, index) => [
        ...elements.map(({ id }) => `MB.reveal(tl, "#${scene.id}-${id}", at("${scene.id}-${id}"), "fade");`),
        ...hideWhenNextStarts(scene, blocks[index + 1]?.scene, unit),
      ])
      .join("\n"),
  };
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

function lineHtml(scene: Scene, element: SceneElement): string {
  const id = `${scene.id}-${element.id}`;
  const lines = element.value.lines;

  if (Array.isArray(lines) && lines.every((line) => typeof line === "string")) {
    return `<pre id="${id}" class="mb-card mb-mono fb-code">${escape(lines.join("\n"))}</pre>`;
  }

  return `<div id="${id}" class="fb-line">${escape(textOf(scene, element.value))}</div>`;
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

/** On a Canvas, a Scene's lines give way to the next Scene's when it starts. */
function hideWhenNextStarts(scene: Scene, next: Scene | undefined, unit: UnitTiming): string[] {
  if (!next) {
    return [];
  }

  return [`tl.set("#fb-${scene.id}", { autoAlpha: 0 }, ${unit.sceneStarts[next.id] ?? 0});`];
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ENTITIES[char as keyof typeof ENTITIES]);
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
