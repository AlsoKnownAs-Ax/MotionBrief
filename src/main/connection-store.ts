import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { z } from "zod";
import {
  CONNECTION_STORE_CHANNEL,
  type ConnectionStoreResponse,
  type StoredConnectionMessage,
} from "../shared/ipc";

const MethodSchema = z.enum(["subscription", "api-key"]);

const RequestSchema = z.object({
  channel: z.literal(CONNECTION_STORE_CHANNEL),
  id: z.number(),
  save: z.object({ method: MethodSchema.optional(), apiKey: z.string().optional() }).optional(),
});

/** On disk the key is only ever safeStorage ciphertext, base64-encoded; it is never logged. */
const FileSchema = z.object({
  method: MethodSchema.optional(),
  encryptedApiKey: z.string().optional(),
});

function storePath() {
  return join(app.getPath("userData"), "claude-connection.json");
}

/**
 * Answers the core's connection-store requests. Returns undefined for messages on other
 * channels, so the caller can route them elsewhere.
 */
export async function handleConnectionStoreMessage(message: unknown): Promise<ConnectionStoreResponse | undefined> {
  const { success, data: request } = RequestSchema.safeParse(message);

  if (!success) {
    return undefined;
  }

  const reply = { channel: CONNECTION_STORE_CHANNEL, id: request.id } as const;

  if (request.save) {
    const error = await save(request.save);

    return { ...reply, error };
  }

  const { connection, error } = await load();

  return { ...reply, connection, error };
}

async function load(): Promise<{ connection?: StoredConnectionMessage; error?: string }> {
  const text = await readFile(storePath(), "utf8").catch(() => undefined);

  if (text === undefined) {
    return { connection: {} };
  }

  const { success, data: stored } = FileSchema.safeParse(parseJson(text));

  if (!success) {
    return { connection: {} };
  }

  if (!stored.encryptedApiKey) {
    return { connection: { method: stored.method } };
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return { error: "The system keychain isn't available" };
  }

  const apiKey = decrypt(stored.encryptedApiKey);

  if (apiKey === undefined) {
    return { error: "The stored API key couldn't be read from the system keychain" };
  }

  return { connection: { method: stored.method, apiKey } };
}

async function save({ method, apiKey }: StoredConnectionMessage): Promise<string | undefined> {
  if (apiKey && !safeStorage.isEncryptionAvailable()) {
    return "The system keychain isn't available, so the API key can't be stored safely";
  }

  const file = { method, encryptedApiKey: encrypt(apiKey) } satisfies z.infer<typeof FileSchema>;
  const path = storePath();
  const temporary = `${path}.tmp`;

  // Write-then-rename, so a crash never leaves half a file.
  const written = await writeFile(temporary, JSON.stringify(file), { mode: 0o600 })
    .then(() => rename(temporary, path))
    .then(() => true)
    .catch(() => false);

  if (!written) {
    await rm(temporary, { force: true });
    return "The connection couldn't be saved";
  }

  return undefined;
}

function encrypt(apiKey: string | undefined) {
  if (!apiKey) {
    return undefined;
  }

  return safeStorage.encryptString(apiKey).toString("base64");
}

function decrypt(encrypted: string) {
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return undefined;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
