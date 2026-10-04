import { createFileServer, type FileServerHandle } from "@hyperframes/producer";
import puppeteer, { type Browser } from "puppeteer-core";
import PROBE from "./runtime/probe.js?raw";

export type FramePageOptions = {
  /** An assembled page's folder. */
  dir: string;
  chromePath: string;
  width: number;
  height: number;
  /** Device pixels per frame pixel; below 1 for small stills. 1 by default. */
  scale?: number;
};

export type FramePage = {
  /** Moves the whole video to `time` seconds and waits for the frame to paint. */
  seek: (time: number) => Promise<void>;
  /** Evaluates a JavaScript expression in the page and returns its JSON-serializable value. */
  evaluate: <T>(expression: string) => Promise<T>;
  /** A JPEG of the frame as it is now. */
  screenshot: () => Promise<Uint8Array>;
  /** Uncaught errors the page threw. */
  errors: string[];
  close: () => Promise<void>;
};

export type FramePageError = { code: "BROWSER_FAILED"; message: string };

/** How long a page may take to load and report its duration. */
const LOAD_TIMEOUT_MS = 60_000;

/**
 * Opens an assembled page in the pinned chrome-headless-shell, served the way HyperFrames renders
 * it, and waits until its timeline is ready to seek.
 */
export async function openFramePage({ dir, chromePath, width, height, scale = 1 }: FramePageOptions) {
  let server: FileServerHandle | undefined;
  let browser: Browser | undefined;

  try {
    server = await createFileServer({ projectDir: dir });
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    });
    const page = await browser.newPage();
    const errors: string[] = [];

    page.on("pageerror", (error) => errors.push(String((error as Error).message ?? error)));
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.goto(server.url, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction("window.__hf && window.__hf.duration > 0", { timeout: LOAD_TIMEOUT_MS });
    await page.evaluate("document.fonts.ready");
    await page.evaluate(PROBE);

    const opened = { browser, server };
    const framePage: FramePage = {
      seek: async (time) => {
        await page.evaluate(`window.__hf.seek(${time})`);
        await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => resolve(null)))");
      },
      // The caller states what its expression returns; the page can't be type-checked.
      evaluate: <T>(expression: string) => page.evaluate(expression) as Promise<T>,
      screenshot: () => page.screenshot({ type: "jpeg", quality: 75 }),
      errors,
      close: async () => {
        await opened.browser.close();
        opened.server.close();
      },
    };

    return { data: framePage, error: null };
  } catch (error) {
    await browser?.close();
    server?.close();

    return { data: null, error: { code: "BROWSER_FAILED", message: String((error as Error).message ?? error) } satisfies FramePageError };
  }
}
