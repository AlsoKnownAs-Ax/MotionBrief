import type { Scene } from "./schema";

/** A Storyboard element: something in a Scene's content with an id that appears on a Transcript word. */
export type SceneElement = {
  id: string;
  at: number;
  /** Path of the element within the Scene, such as `content.nodes[1]`. */
  field: string;
  /** The element's own fields, such as its label or text. */
  value: Record<string, unknown>;
};

/** Every element of a Scene, in content order. */
export function elementsOf(scene: Scene): SceneElement[] {
  const elements: SceneElement[] = [];

  visit(scene.content, "content", (value, field) => {
    if (typeof value.id === "string" && typeof value.at === "number") {
      elements.push({ id: value.id, at: value.at, field, value });
    }
  });

  return elements;
}

/** A piece of on-screen copy in a Scene's content. Code lines and file names are code, not copy. */
export type SceneCopy = {
  text: string;
  /** Path of the copy within the Scene, such as `content.nodes[1].label`. */
  field: string;
};

const COPY_KEYS = ["text", "label", "title", "note"];

/** Every piece of on-screen copy in a Scene, in content order. */
export function copyOf(scene: Scene): SceneCopy[] {
  const copy: SceneCopy[] = [];

  visit(scene.content, "content", (value, field) => {
    COPY_KEYS.filter((key) => typeof value[key] === "string").forEach((key) =>
      copy.push({ text: value[key] as string, field: `${field}.${key}` }),
    );
  });

  return copy;
}

/** An Asset a Scene shows: a logo in an icon slot, or an image or logo as media. */
export type SceneAsset = {
  id: string;
  slot: "icon" | "media";
  /** Path of the reference within the Scene, such as `content.items[0].icon`. */
  field: string;
};

const ASSET_ICON = "asset:";

/** Every Asset a Scene's content shows, in content order. */
export function assetsOf(scene: Scene): SceneAsset[] {
  const assets: SceneAsset[] = [];

  visit(scene.content, "content", (value, field) => {
    if (typeof value.icon === "string" && value.icon.startsWith(ASSET_ICON)) {
      assets.push({ id: value.icon.slice(ASSET_ICON.length), slot: "icon", field: `${field}.icon` });
    }

    if (typeof value.asset === "string") {
      assets.push({ id: value.asset, slot: "media", field: `${field}.asset` });
    }
  });

  return assets;
}

/** Calls `onObject` for every object nested in `value`, with its field path. */
function visit(value: unknown, field: string, onObject: (value: Record<string, unknown>, field: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${field}[${index}]`, onObject));
    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  const object = value as Record<string, unknown>;
  onObject(object, field);
  Object.entries(object).forEach(([key, child]) => visit(child, `${field}.${key}`, onObject));
}
