import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ChatEntrySchema, type ChatEntry, type Format } from "../../contract";
import { fileStep, type FileError, type Result } from "./files";

/**
 * `<format>/chat.jsonl`: the video's chat, its Revision log and its queue, as an append-only log. Each line is a
 * change to one entry: the first line of an entry sends it, later ones say how it went. A line half written when the
 * app died is skipped.
 */
const CHAT_FILE = "chat.jsonl";

/** A change to a chat entry: its id, and the fields it sets. */
export type ChatLine = Partial<ChatEntry> & { id: string };

const ChatLineSchema = ChatEntrySchema.partial().required({ id: true });

/** Appends a line; a line left half written by a crash is ended first, so the new one stays readable. */
export async function appendChat(dir: string, format: Format, line: ChatLine): Promise<Result<null, FileError>> {
  const path = join(dir, format, CHAT_FILE);
  const { error } = await fileStep(path, async () => {
    await mkdir(join(dir, format), { recursive: true });
    const text = `${JSON.stringify(ChatLineSchema.parse(line))}\n`;
    await appendFile(path, `${await tornTail(path)}${text}`);
  });

  if (error) {
    return { data: null, error };
  }

  return { data: null, error: null };
}

/** The video's chat entries in the order they were sent, each as its lines add up; none before the first. */
export async function readChat(dir: string, format: Format): Promise<Result<ChatEntry[], FileError>> {
  const path = join(dir, format, CHAT_FILE);
  const { data: text, error } = await fileStep(path, () => readFile(path, "utf8"));

  if (error?.message.includes("ENOENT")) {
    return { data: [], error: null };
  }

  if (error) {
    return { data: null, error };
  }

  const entries = new Map<string, Partial<ChatEntry>>();

  text
    .split("\n")
    .map((line) => ChatLineSchema.safeParse(parseJson(line)))
    .filter(({ success }) => success)
    .map(({ data }) => data!)
    .forEach((line) => entries.set(line.id, { ...entries.get(line.id), ...line, at: entries.get(line.id)?.at ?? line.at }));

  return {
    data: [...entries.values()]
      .map((entry) => ChatEntrySchema.safeParse(entry))
      .filter(({ success }) => success)
      .map(({ data }) => data!),
    error: null,
  };
}

/** A line break when the log's last line has none: what it takes to end a line the app died writing. */
async function tornTail(path: string): Promise<string> {
  const file = await open(path, "r").catch(() => undefined);

  if (!file) {
    return "";
  }

  try {
    const { size } = await file.stat();

    if (size === 0) {
      return "";
    }

    const last = Buffer.alloc(1);
    await file.read(last, 0, 1, size - 1);

    if (last.toString() === "\n") {
      return "";
    }

    return "\n";
  } finally {
    await file.close();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
