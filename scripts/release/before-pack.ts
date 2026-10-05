// electron-builder's beforePack hook (electron-builder.yml): refuses to pack a vendor/ that doesn't match deps.json.
import { join } from "node:path";
import type { Configuration } from "electron-builder";
import { describeError } from "../deps/errors.ts";
import type { VendorError } from "./vendor.ts";
import { checkVendor } from "./vendor.ts";

// electron-builder 26.15's own BeforePackContext export points at a declaration file it doesn't ship.
type BeforePackContext = Parameters<Extract<Configuration["beforePack"], (context: never) => unknown>>[0];

/** electron-builder's Arch enum, by value. */
const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"];

export default async function beforePack({ electronPlatformName, arch }: BeforePackContext) {
  const archName = ARCH_NAMES[arch] ?? String(arch);
  const { error } = await checkVendor({ rootDir: join(import.meta.dirname, "../.."), platform: electronPlatformName, arch: archName });

  if (error) {
    throw new Error(`Not packing ${electronPlatformName}-${archName}: ${describeVendorError(error)}`);
  }
}

function describeVendorError(error: VendorError) {
  if (error.code === "UNSUPPORTED_PLATFORM") {
    return "MotionBrief ships for Windows x64 and macOS arm64 only.";
  }

  if (error.code === "VENDOR_MISMATCH") {
    // Postinstall fetches only the host's binaries, so each platform is packed on its own OS.
    return `vendor/${error.name} wasn't installed at deps.json's pin ${error.expected} for this platform. Run pnpm deps:fetch on this platform's OS.`;
  }

  return describeError(error);
}
