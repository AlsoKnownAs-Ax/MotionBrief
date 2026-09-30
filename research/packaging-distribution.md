# Packaging & distribution research — MotionBrief desktop (Win x64 + macOS arm64)

Researched 2026-09-30. Sources are primary where possible (vendor docs, source code, and binaries inspected directly). **[Verified]** means I checked the artifact or source myself in this session. **[Uncertain]** marks claims that you should confirm before relying on them.

Binaries inspected directly:
- `@anthropic-ai/claude-agent-sdk@0.3.285` (bundles Claude Code 2.1.285), with `-darwin-arm64` and `-win32-x64`
- Chrome for Testing `chrome-headless-shell` 154.0.8037.92 (Stable)
- osxexperts `ffmpeg9arm.zip`
- Martin Riedl FFmpeg 9.0.2 arm64

I read the macOS signatures with a small Mach-O `LC_CODE_SIGNATURE` parser and the Windows signatures with `Get-AuthenticodeSignature`.

---

## TL;DR / recommendations

1. **Use electron-builder (stable v26.15.x; v27 is in alpha).** Reasons:
   - It has first-class per-file signing control (`mac.signIgnore` / v27 `mac.sign.ignore`, `win.signExts`).
   - electron-updater supports blockmap differential updates for both NSIS and the macOS zip.
   - It publishes to GitHub Releases and supports stable/beta channels.
   - Comparable OSS apps with large bundled binaries use it: LosslessCut, Kap, Cherry Studio, and Nimbalyst (Nimbalyst bundles the Claude Agent SDK).

   Forge + Squirrel/update.electronjs.org has no differential update on macOS.
2. **macOS signing plan:**
   - Leave the Anthropic-signed `claude` binary alone (`signIgnore`). It is already Developer ID + hardened runtime + secure timestamp **[Verified]**.
   - Re-sign `chrome-headless-shell` and its dylibs with `allow-jit`.
   - Re-sign FFmpeg. Better: switch the mac FFmpeg source from osxexperts to Martin Riedl's builds (see §7).
   - Sign `whisper-cli` with no entitlements.
   - Do a test notarization early.
3. **Windows signing for a Romanian individual:**
   - Azure Artifact Signing is **not available to individuals outside US/CA**. It is available to EU *organizations*, so it becomes an option only if you form an SRL (or possibly a PFA **[Uncertain]**).
   - SignPath Foundation is **very likely ineligible**, because it forbids proprietary components and Claude Code is proprietary.
   - The realistic choice is **Certum Open Source Code Signing in the Cloud (~€49/yr, SimplySign)**. CI automation for it is clunky.
   - Leave `claude.exe` as-is (Anthropic Authenticode-signed **[Verified]**). Sign every other exe/dll yourself, because Smart App Control checks all loaded modules.
4. **FFmpeg GPL:**
   - Ship the GPL text and notices.
   - Host the exact Corresponding Source yourself as release assets: FFmpeg at the exact commit, every statically linked library, and the build scripts.
   - Don't rely on BtbN/osxexperts links. BtbN deletes dailies after 14 days, and osxexperts doesn't identify its sources.

---

## 1. electron-builder vs Electron Forge

Current versions (npm, 2026-09-30):

| Package | Version |
|---|---|
| `electron-builder` | 26.15.3 (latest); 26.17.0 (v26 tag); 27.0.0-alpha.9 (next) |
| `electron-updater` | 6.8.9 |
| `@electron-forge/cli` | 8.0.1 |
| `@electron/osx-sign` | 2.7.1 |
| `@electron/notarize` | 3.1.1 |
| `@electron/windows-sign` | 2.1.0 |
| `update-electron-app` | 3.3.0 |
| `electron` | 44.5.1 |

Source: registry.npmjs.org.

| Capability | electron-builder | Electron Forge |
|---|---|---|
| macOS signing engine | Uses `@electron/osx-sign` under the hood ([mac docs](https://www.electron.build/docs/mac)). | Uses `@electron/osx-sign` via packager `osxSign` ([Forge docs](https://www.electronforge.io/guides/code-signing/code-signing-macos)). |
| Exclude one nested binary from re-signing | v26: `mac.signIgnore` (regex list). v27: `mac.sign.ignore` ([mac docs](https://www.electron.build/docs/mac)). Real-world example: Nimbalyst's `signIgnore` ([package.json](https://github.com/nimbalyst/nimbalyst/blob/main/packages/electron/package.json)). | `osxSign.ignore` (string / regex / function). Implemented in osx-sign `shouldIgnoreFilePath` ([src/sign.ts](https://github.com/electron/osx-sign/blob/main/src/sign.ts), [src/types.ts](https://github.com/electron/osx-sign/blob/main/src/types.ts)). |
| Per-binary entitlements | v26: `entitlements` (app) + `entitlementsInherit` (one plist for **all** nested code). v27: per-file defaults modelled on Chromium, plus custom sign function / `ElectronSignOptions` pass-through, so `optionsForFile` is reachable ([mac docs](https://www.electron.build/docs/mac)). `mac.binaries` / `mac.sign.binaries` lists extra Mach-Os to sign. | `osxSign.optionsForFile(filePath)` returns entitlements, hardenedRuntime, etc. per file ([osx-sign](https://github.com/electron/osx-sign)). This is the most flexible option. |
| Notarization | Built in via `@electron/notarize` (notarytool). Env options: `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` (recommended), or Apple ID + app-specific password, or keychain profile ([mac docs → notarize](https://www.electron.build/docs/mac#notarize)). | `osxNotarize` via `@electron/notarize`. |
| Windows signing | Signs the main exe **and every `.exe` in extraResources/extraFiles subdirs and `app.asar.unpacked`**. Filter with `win.signExts`, e.g. `["!claude.exe"]` to skip (negative patterns supported, [winPackager.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/winPackager.ts)). Also supports Azure Trusted/Artifact Signing: v26 `win.azureSignOptions`, v27 `win.sign: {type: "azure"}` ([win signing docs](https://www.electron.build/docs/features/code-signing/code-signing-win)). A custom sign hook covers other cloud HSMs. | `@electron/windows-sign`: scans a folder for signable files, supports hook modules, and handles cloud HSMs ([README](https://github.com/electron/windows-sign)). |
| Auto-update | `electron-updater`: NSIS (Windows), dmg+zip (mac). **Blockmap differential downloads on both** (§5). Update-manifest signing (v27). Staged rollouts. | Built-in `autoUpdater` = Squirrel.Windows (full + optional delta `.nupkg` when `remoteReleases` is set) and Squirrel.Mac (**full zip every time**). The free `update.electronjs.org` needs a public GitHub repo + GitHub Releases + signed mac builds ([README](https://github.com/electron/update.electronjs.org)). |
| GitHub Releases publishing | `publish: github` with `--publish onTag/always`. The GitHub provider reads the releases Atom feed ([GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)). | `@electron-forge/publisher-github`. |
| Channels | `latest` / `beta` / `alpha` via version suffix + `generateUpdatesFilesForAllChannels`. **For GitHub you must set `channel` explicitly** because detection is disabled ([channels tutorial](https://www.electron.build/docs/tutorials/release-using-channels)). Client side: `autoUpdater.channel = "beta"`. | Not built in. Use separate feeds/repos or prerelease handling. |

**Comparable OSS apps.** All of these use electron-builder:
- LosslessCut (ffmpeg via `extraResources`)
- Kap (ffmpeg, electron-updater)
- Cherry Studio (electron-updater)
- Nimbalyst: bundles `@anthropic-ai/claude-agent-sdk-darwin-${arch}` via `mac.extraResources` into `app.asar.unpacked`, publishes to GitHub Releases, `generateUpdatesFilesForAllChannels: true`

I checked their `package.json` files via the GitHub API. I found no comparable large-binary OSS app on Forge in this pass. **[Uncertain — not exhaustive]**

---

## 2. macOS notarization with a nested binary signed by another Team ID (Anthropic)

**Facts about the bundled `claude` binary (darwin-arm64, SDK 0.3.285, 224 MB)** **[Verified]**:
- Identifier `com.anthropic.claude-code`, TeamID **Q6L2SF6YDW**, signer "Developer ID Application: Anthropic PBC (Q6L2SF6YDW)".
- CodeDirectory flags `0x10000` = **hardened runtime on**.
- CMS contains an RFC 3161 **secure timestamp**.
- Embedded entitlements:
  - `cs.allow-jit`
  - `cs.allow-unsigned-executable-memory`
  - `cs.disable-library-validation`
  - `device.audio-input`
  - `automation.apple-events`

**Does notarytool accept it?** Apple's requirements apply per executable:
- signed with a **Developer ID** certificate
- hardened runtime
- secure timestamp
- no `get-task-allow`
- linked against SDK ≥ 10.9

([Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)). Nothing there requires the nested code's Team ID to match the outer app's, and the Anthropic binary meets every listed requirement. **[Uncertain in practice]** I found no Apple doc that says "a different team is OK" in so many words. Run a throwaway notarization in the first CI spike.

**`codesign --verify --deep --strict`**: the outer seal records the nested code's hash/requirement and does not require the same team. Nimbalyst's afterSign shows the other valid route: it re-signs everything with its own identity (`codesign --deep --force`) plus broad entitlements ([afterSign.js](https://github.com/nimbalyst/nimbalyst/blob/main/packages/electron/build/afterSign.js)). So both keeping and replacing Anthropic's signature work in practice.

**Gatekeeper / library validation**: library validation applies only to code *loaded* into a process. Executables that are *spawned* are not subject to it. electron-builder's docs say so explicitly and skip such executables in its foreign-signature check ([mac docs → "Loading third-party or unsigned binaries"](https://www.electron.build/docs/mac)). The spawned `claude` process runs under its own signature and entitlements.

**Keep or re-sign?**
- **Keep (recommended):** `mac.signIgnore: ["claude-agent-sdk-darwin-arm64/claude$"]`. If you re-sign instead, you must replicate Anthropic's entitlements. v27's default nested entitlements (`allow-jit` + `device.*`) lack `allow-unsigned-executable-memory` and `disable-library-validation`, which the Bun/JSC binary declares. Re-signing with those defaults risks a runtime crash **[Uncertain whether all are needed; untested]**.
- **TCC caveat:** microphone and Apple Events prompts triggered by the child are attributed to the responsible (outer) app. Add `NSMicrophoneUsageDescription` / `NSAppleEventsUsageDescription` to the outer Info.plist if Claude Code features need them. Nimbalyst does exactly this. **[Medium confidence]**

**Known issues bundling the Agent SDK in Electron:**
- **asar:** the binary must live outside `app.asar`. Either `asarUnpack: node_modules/@anthropic-ai/**` or copy the platform package into `app.asar.unpacked` via `extraResources`. Otherwise the SDK resolves a path inside `app.asar` → "native binary not found" / spawn ENOENT ([nimbalyst#123](https://github.com/nimbalyst/nimbalyst/issues/123)). Pass `pathToClaudeCodeExecutable` explicitly ([SDK docs](https://code.claude.com/docs/en/agent-sdk/typescript)).
- **Cross-arch builds:** the per-platform packages are `optionalDependencies` filtered by the host OS/arch, so CI must install the target's package (e.g. `npm i --no-save --force @anthropic-ai/claude-agent-sdk-win32-x64@<ver>`) ([nimbalyst#123](https://github.com/nimbalyst/nimbalyst/issues/123)).
- **`env` replaces instead of merging:** passing `env` without `PATH` → `spawn … ENOENT` ([sdk#208](https://github.com/anthropics/claude-agent-sdk-typescript/issues/208)).
- **Historical notarization failure:** SDK ≤0.1.57 shipped unsigned `libjansi.jnilib` inside a JetBrains-plugin `.jar` ([sdk#91](https://github.com/anthropics/claude-agent-sdk-typescript/issues/91), [claude-code#12997](https://github.com/anthropics/claude-code/issues/12997)). 0.3.285's main package has no `vendor/` dir (19 files) **[Verified]**, so this is resolved for current versions.
- **Linux musl/glibc mis-pick** ([sdk#323](https://github.com/anthropics/claude-agent-sdk-typescript/issues/323)): not relevant to Win/mac.
- **Licensing:** the binary is "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements" (package `LICENSE.md`, [legal page](https://code.claude.com/docs/en/legal-and-compliance)) **[Verified]**. Confirm the redistribution terms. This also matters for SignPath (§4).

---

## 3. Entitlements under hardened runtime

**Child processes do not inherit entitlements.** Each Mach-O carries its own entitlements in its own signature. Hardened runtime and library validation are evaluated per process ([electron-builder mac docs](https://www.electron.build/docs/mac): "Nested binaries do **not** inherit the app's entitlements … Executables (such as a bundled `ffmpeg`) are spawned rather than loaded, so they are not subject to library validation"). `com.apple.security.inherit` is an App Sandbox concept and is irrelevant for a non-sandboxed Developer ID app.

| Binary | Current signature | What to do |
|---|---|---|
| `chrome-headless-shell` (CfT 154, mac-arm64) | **Not Google-signed.** Ad-hoc, linker-signed (flags `0x20002`), no hardened runtime, no team **[Verified]**. The same is true of its dylibs: `libvk_swiftshader.dylib`, `libvulkan.dylib`, `libEGL.dylib`, `libGLESv2.dylib`. Also in the folder: `.pak`/`.dat`/`.bin` resources and a `vk_swiftshader_icd.json`. | Re-sign **every dylib first, then the executable**, with your Developer ID + `--options runtime --timestamp`. Entitlements: **`com.apple.security.cs.allow-jit`** only. Chromium's own renderer/GPU helpers carry only `allow-jit` ([helper-renderer-entitlements.plist](https://chromium.googlesource.com/chromium/src/+/main/chrome/app/helper-renderer-entitlements.plist), [helper-gpu-entitlements.plist](https://chromium.googlesource.com/chromium/src/+/main/chrome/app/helper-gpu-entitlements.plist)), and SwiftShader's JIT uses `MAP_JIT` ([crbug 40636853](https://issues.chromium.org/40636853)). Signing the dylibs with the same team means `disable-library-validation` isn't needed. **[Test: run a headless render incl. WebGL under the notarized build]** Unzipping on Windows turned symlinks into small files; do the extraction on macOS to preserve them. |
| FFmpeg (osxexperts `ffmpeg9arm.zip`) | Ad-hoc, linker-signed, no hardened runtime **[Verified]**. Static: links only `/usr/lib` and `/System/Library/Frameworks` **[Verified]**. | Re-sign with hardened runtime; no entitlements needed. See §7 for why a different build is recommended. |
| FFmpeg (Martin Riedl 9.0.2 arm64) | Signed "Developer ID Application: Martin Riedl (KU3N25YGLU)", hardened runtime, secure timestamp **[Verified]**. | Can ship as-is (another foreign-team nested exe) or re-sign. |
| `whisper-cli` (self-built, Metal) | Yours. | Sign with hardened runtime and **no entitlements**. Metal shader compilation is GPU code, not CPU JIT. Build with `GGML_METAL_EMBED_LIBRARY=ON` so no `.metal` file is read at runtime. If you use ggml backend dylibs, sign them with the same team. **[Medium confidence; test]** |
| Electron app itself | — | `allow-jit` is enough for modern Electron ([electron-builder mac docs](https://www.electron.build/docs/mac)). |

---

## 4. Windows code signing for an individual EU (Romania) OSS maintainer

**Azure Artifact Signing (formerly Trusted Signing)**
- *Public Trust* is available to **organizations** in the US, CA, EU, UK, AU, NZ, JP, KR, SG, CH, NO, and IL. **Individual developers must be in the US or Canada** ([Quickstart, updated 2026-09-29](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart); [Windows code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)).
- A Romanian individual is **not eligible**. A Romanian SRL would qualify as an organization. Organization validation needs:
  - a legal entity with a business identifier
  - a website and an email on its domain
  - 1–20 business days of processing
- Whether a PFA (sole trader) counts as an "organization" is unclear ([MS Q&A on sole proprietors](https://learn.microsoft.com/en-in/answers/questions/6001849/azure-artifact-signing-eligibility-for-public-trus)). **[Uncertain]**
- Price: Basic $9.99/month (5,000 signatures), Premium $99.99/month ([SKU doc](https://github.com/MicrosoftDocs/azure-docs/blob/main/articles/artifact-signing/how-to-change-sku.md)). Certificates are short-lived (daily), timestamped.
- electron-builder: v26 `win.azureSignOptions {publisherName, endpoint, codeSigningAccountName, certificateProfileName}` with Entra env vars; v27 `win.sign {type:"azure"}` via signtool `/dlib` ([docs](https://www.electron.build/docs/features/code-signing/code-signing-win)).

**SignPath Foundation (free)** — [conditions](https://signpath.org/terms.html)
- OSI license, no commercial dual-licensing.
- **"No proprietary code: the project may not contain any proprietary, non open-source component."** MotionBrief bundles the proprietary Claude Code binary, so it is **very likely ineligible**. Chrome-for-Testing's `ABOUT` also says "Google Chrome … All rights reserved".
- You may **not** sign upstream binaries (ffmpeg, chrome) with the Foundation cert. They may only be included unsigned, which conflicts with Smart App Control (below).
- The certificate is issued to "SignPath Foundation", not to you.
- Every release needs **manual approval**.
- Workflow requirements:
  - team roles (authors/reviewers/approvers)
  - MFA
  - a "Code signing policy" page
  - builds via the `signpath/github-action-submit-signing-request` action from a GitHub workflow artifact
  - for OSS, **all jobs on GitHub-hosted runners** ([GitHub connector docs](https://docs.signpath.io/trusted-build-systems/github))
- electron-builder fit is poor. You'd build `--dir`, submit a zip for deep signing, then build the NSIS from the prepackaged app, then submit the installer. That is two approvals, and `latest.yml`/blockmap must be regenerated after external signing. Turnaround for acceptance isn't published. **[Uncertain]**

**Certum Open Source Code Signing**
- "Open Source Code Signing **in the Cloud**" (SimplySign, no token): **from €49**. "Set" with card+reader: €69. Code for your own card: €25 ([Certum shop](https://shop.certum.eu/code-signing.html)).
- Issued to individuals after ID verification; the subject reads "Open Source Developer, <Name>" ([rubyinstaller2 wiki](https://github.com/oneclick/rubyinstaller2/wiki/CertumCodeSigning), [piers.rocks write-up](https://piers.rocks/2025/10/30/certum-open-source-code-sign.html)).
- Builds SmartScreen reputation like any OV cert.
- CI: SimplySign Desktop exposes a virtual smart card on Windows, and login needs a TOTP from the SimplySign app. Automation on a GitHub Windows runner is possible but hacky (extract the `otpauth://` secret, generate the TOTP, inject it via SendKeys) ([devas.life guide](https://www.devas.life/how-to-automate-signing-your-windows-app-with-certum)).
- Cloud certs are capped at 5,000 signatures/month ([SSLmentor FAQ](https://www.sslmentor.com/help/code-faq)).
- Since 2026-02-27, certificate validity is ≤459 days.

**OV/EV post-2023**
- Since June 2023 keys must be on an HSM or token ([Microsoft options page](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)).
- **EV no longer bypasses SmartScreen (removed in 2024).** OV, EV, and Artifact Signing all build reputation over time.
- OV costs ~$150–300/yr, EV $400+/yr (same page).

**Bundled third-party exes on Windows** **[Verified]**:
- `claude.exe`: **Authenticode-signed "Anthropic, PBC"** (DigiCert G4 CS RSA4096 CA; subject has businessCategory "Private Organization", i.e. an EV-type cert), timestamped by DigiCert.
- `chrome-headless-shell.exe` and its DLLs (`libEGL.dll`, `libGLESv2.dll`, `vk_swiftshader.dll`, `vulkan-1.dll`): **NotSigned**.
- BtbN ffmpeg: not Authenticode-signed. **[Uncertain — not re-verified by download this session]**

**Recommendation:**
- Leave `claude.exe` untouched: electron-builder would otherwise replace the signature, so use `win.signExts: ["!claude.exe"]`.
- Sign all other exes/dlls with your cert. Windows 11 **Smart App Control evaluates signatures of all code modules, including DLLs**, not just the entry exe; unsigned or unknown modules get blocked ([Win11 Security Book](https://learn.microsoft.com/en-us/windows/security/book/application-security-application-and-driver-control), [SAC FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)). Microsoft's guidance is to sign every exe/dll you ship.
- electron-builder by default only auto-signs `.exe`. Add `.dll` via `signExts: [".dll", "!claude.exe"]` so whisper's ggml DLLs and the Chrome DLLs get signed.

---

## 5. Delta updates (electron-updater) and GitHub limits

**How it works:**
- For each target, electron-builder writes a content-defined **blockmap**: `<artifact>.blockmap` for the mac zip and the NSIS exe, or embedded for nsis-web.
- The client downloads the old and new blockmaps, computes changed blocks, and fetches only those ranges. It falls back to a full download on any error ([AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/AppUpdater.ts), [downloadPlanBuilder.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/differentialDownloader/downloadPlanBuilder.ts)).
- **NSIS:** `differentialPackage` defaults to true, so the app payload is a **non-solid 7z with a 1 MB dictionary**. The source comment: "solid compression leads to a lot of changed blocks" ([differentialUpdateInfoBuilder.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts)). v27 adds `differentialPackage: "store-asar"`: storing the asar uncompressed cut a one-line change from 100% to 0.2% of a 32 MB asar ([nsisOptions.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)).
- **mac zip:** MacUpdater downloads the zip differentially against the **cached previous `update.zip`**. **The first update after a fresh DMG install is a full download** ("Unable to locate previous update.zip … falling back to full download"). It then serves the file to Squirrel.Mac via a localhost proxy ([MacUpdater.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/MacUpdater.ts)).
- The GitHub provider sets `isUseMultipleRangeRequest: false`, so ranges are fetched one per request. That's slower, but it works ([GitHubProvider.ts](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts)).

**Expected savings when the Claude binary changes:**
- Each file is compressed as its own stream, so a changed file costs roughly the compressed bytes from the first differing byte onward. In the worst case that is the whole compressed file.
- The npm tarballs give a proxy for the compressed size: **~98 MB (darwin-arm64 gzip) and ~110 MB (win32-x64 gzip)** **[Verified]**.
- Unchanged Electron, Chrome, FFmpeg, and whisper blocks are reused.
- Estimate: an SDK-bump release downloads **≈ 100–120 MB + the changed asar**, versus a ~550–650 MB full installer. **[Estimate — measure via updater log "File has N changed blocks"]**
- Bun `--compile` binaries might share a prefix across versions if the Bun runtime is unchanged, which would save more. **[Uncertain]**
- With Forge/Squirrel.Mac, every mac update is the **full zip**.

**GitHub Releases limits:**
- Each asset must be **under 2 GiB**.
- Up to **1,000 assets per release**.
- **No limit on total release size or bandwidth** ([about-releases](https://github.com/github/docs/blob/main/content/repositories/releasing-projects-on-github/about-releases.md); size/count values from [large_files.yml](https://github.com/github/docs/blob/main/data/variables/large_files.yml) and [releases.yml](https://github.com/github/docs/blob/main/data/variables/releases.yml)).

**Squirrel.Mac caveats:**
- The app must be signed ([auto-update docs](https://www.electron.build/docs/features/auto-update)), and the update must satisfy the running app's designated requirement. **Changing signing identity or team breaks updates.** On Windows, electron-updater also checks the installer's publisher name. Plan any cert change (e.g. Certum → Azure) as a transition release ([key rotation docs](https://www.electron.build/docs/features/key-rotation)).
- Staging a ~600 MB app needs about 2× the free disk space. **[Uncertain]**

---

## 6. GitHub Actions and Apple enrollment

**Runners** ([supported runners, public repos](https://github.com/github/docs/blob/main/data/reusables/actions/supported-github-runners.md)):
- **Free and unlimited for public repos** on standard hosted runners ([Actions billing](https://github.com/github/docs/blob/main/content/billing/concepts/product-billing/github-actions.md)).
- macOS arm64: `macos-latest`, `macos-14`, `macos-15`, `macos-26`. Specs: 3-core M1, 7 GB RAM, 14 GB SSD.
- Windows x64: `windows-latest` = `windows-2025`, `windows-2022`. Specs: 4 cores, 16 GB, 14 GB SSD.
- The 14 GB disk is tight for a whisper build plus ~0.6 GB artifacts. Clean up between steps.

**Notarization credentials in secrets:**
- electron-builder reads `APPLE_API_KEY` (path to the `.p8`), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`. This is the recommended option ([mac docs → notarize](https://www.electron.build/docs/mac#notarize)).
- Store the `.p8` content base64 in a secret and write it to a temp file in the job.
- The Developer ID Application cert goes in `CSC_LINK` (base64 .p12) + `CSC_KEY_PASSWORD`.

**Apple Developer Program:**
- **99 USD/yr**, charged in local currency.
- Individuals and sole proprietors can enroll with a 2FA Apple Account and their legal name. No D-U-N-S needed for individuals ([enroll page](https://developer.apple.com/programs/enroll/)). Your personal legal name appears as the Developer ID signer.
- I found no country restriction affecting Romania. **[Medium-high confidence]**
- Caveat: 2026 forum reports show new individual teams getting notarization rejected with statusCode 7000 "Team is not yet configured for notarization", or stuck "In Progress" for days. Enroll well before the first release ([Apple forums, Notarization tag](https://developer.apple.com/forums/tags/notarization?page=2)).

---

## 7. FFmpeg GPL compliance

**Licence of the builds:**
- **BtbN `gpl` variant = GPLv3.** `defaults-gpl.sh`: `--enable-gpl --enable-version3`, `LICENSE_FILE=COPYING.GPLv3` ([repo](https://github.com/BtbN/FFmpeg-Builds)).
- **osxexperts** is configured `--enable-gpl` without version3 (GPLv2+). It statically bundles x264, x265, vvenc, vmaf, aom, and others **[Verified via embedded configure string]**.
- **Martin Riedl** 9.0.2 is `--enable-gpl --enable-version3 --enable-openssl`, no nonfree ([versions.txt](https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/versions.txt)) **[Verified]**.

**What must accompany releases** (GPLv3 §1 "Corresponding Source" and §6; GPLv2 §3 — [GPLv3](https://www.gnu.org/licenses/gpl-3.0.txt), [GPLv2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt)):
- The licence text and notices.
- The **complete Corresponding Source for the exact binary**. That means all source needed to generate it, "including scripts to control those activities". Concretely:
  - FFmpeg at the exact commit
  - the exact source of every statically linked library
  - the build scripts, configure line, and patches
- For downloads, GPLv3 **§6(d)** is the natural route: offer the source "in the same way through the same place". It may be on a third-party server if you keep clear directions next to the binary, but "**you remain obligated to ensure that it is available**".
- A 3-year written offer (§6(b) / GPLv2 §3(b)) also works, but it creates an ongoing obligation.
- Simplest robust approach: attach `ffmpeg-<ver>-<platform>-source.tar.xz` (+ build scripts) as assets on each GitHub Release that ships that binary. Alternatively, keep a dedicated `ffmpeg-sources` release that you never delete, and link to it from the release notes and the About/licences screen.
- Invoking ffmpeg as a separate program via CLI is mere aggregation, so the MIT app is unaffected ([GPL FAQ: MereAggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)).

**Do the upstreams publish per-build sources?**
- **BtbN:**
  - No source tarballs.
  - Each release names the FFmpeg commit (e.g. `n9.0.2-14-gebafaee10a`), and the tag pins the FFmpeg-Builds commit (e.g. `autobuild-2026-09-29-13-10` → `6c9aec5f…`). Its `scripts.d/` pins dependency repos and commits.
  - **Retention: dailies kept 14 days, last-of-month kept 2 years** ([README](https://github.com/BtbN/FFmpeg-Builds)). Links to BtbN will rot, so you must mirror the sources yourself: FFmpeg-Builds at the tag + FFmpeg + every `scripts.d` source.
- **osxexperts:**
  - Publishes only a generic build script. It names no dependency versions per build.
  - "Source used to compile" links FFmpeg `release/6.1`, while the binary reports **"FFmpeg version 9.0"** **[Verified]**.
  - The binary is labelled "for educational purposes only", and the site's licence page is an Apache-2.0 boilerplate "Copyright 2021 Martin Riedl" ([site](https://www.osxexperts.net/), [license](https://www.osxexperts.net/license.html)).
  - **You cannot reliably produce Corresponding Source for this binary.** Replace it.
- **Martin Riedl** ([ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de/)):
  - Release and snapshot builds for macOS arm64.
  - **Developer ID signed + hardened runtime + timestamped** **[Verified]**; the installer is notarized.
  - Per-build `versions.txt` lists every dependency version; the build script is open source ([git.martin-riedl.de/ffmpeg/build-script](https://git.martin-riedl.de/ffmpeg/build-script)).
  - You'd still need to mirror sources. **[Uncertain: whether the script revision per build is identifiable]**
- **Best option:** build FFmpeg yourself in CI (BtbN scripts for Windows, Riedl's script for mac). The exact Corresponding Source then falls out of the build.

---

## Open questions / to verify in a spike

1. Test-notarize a bundle containing the Anthropic-signed `claude`, left unmodified, and confirm Gatekeeper launches it on a clean Mac.
2. Confirm chrome-headless-shell works (incl. WebGL/SwiftShader) with only `allow-jit` after re-signing.
3. Confirm the Claude Code redistribution terms and Chrome for Testing redistribution terms.
4. Azure Artifact Signing: does a Romanian PFA pass organization validation, or is an SRL required?
5. Measure the actual differential size of an SDK-bump update on both platforms.
