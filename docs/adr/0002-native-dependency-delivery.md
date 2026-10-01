# Native dependencies ship in the installer, pinned to the app release

MotionBrief bundles every native executable it spawns (the Claude Code binary, chrome-headless-shell, GPL FFmpeg/FFprobe, whisper-cli) in its installer, and downloads only the whisper model (~574 MB) during first-run setup. Everything is pinned to the app release by a checked-in manifest (version, URL, SHA-256 we computed ourselves) that the packager, the contributor `postinstall`, and the app's model download all verify. Bundled executables are signed and notarised with the app, which avoids Gatekeeper/SmartScreen trouble with runtime-downloaded binaries, and pinning keeps HyperFrames (v0.x), Puppeteer, Chrome and FFmpeg versions that are known to work together. The cost is a ~550–650 MB installer.

## Considered Options

- **Thin installer, download everything on first run**: small installer, but executables fetched at runtime sit outside notarisation and can drift from the versions HyperFrames was tested with.
- **Use the user's installed `claude`**: saves ~240 MB, but the CLI version drifts from what the Agent SDK expects and forces API-key users to install Claude Code. The bundled binary still reads the user's `~/.claude` credentials, so a subscription login made through Anthropic's own flow keeps working.
- **LGPL FFmpeg**: HyperFrames encodes H.264 with libx264 and has no `h264_mf`/OpenH264 path, so Windows machines without an nvenc/qsv/amf GPU could not export, and no maintained LGPL macOS arm64 build exists.
- **Independent dependency updates**: rejected; dependencies change only through an app release.

## Consequences

- FFmpeg is GPL, shipped as a separate executable run as a subprocess, so MotionBrief's own code stays MIT. Every release must attach the matching FFmpeg source and the GPL text. H.264 patent licensing is not addressed in v1.
- whisper.cpp publishes no macOS CLI and no Vulkan build, so a `native-deps` CI workflow builds whisper-cli (macOS arm64 Metal; Windows x64 Vulkan + CPU via `GGML_BACKEND_DL`) and publishes it on a MotionBrief GitHub Release.
- **Amended (Packaging & distribution):** the `native-deps` workflow also builds FFmpeg/FFprobe: a minimal GPL build with libx264/libx265 for both platforms. It replaces the BtbN and osxexperts prebuilts. osxexperts can't be made GPL-compliant (its linked source doesn't match the binary), and BtbN deletes its builds after 14 days. Building it ourselves gives us the exact source and build scripts to attach to each release.
- Supported platforms are Windows x64 and macOS arm64 only.
- The Claude Code binary keeps Anthropic's signature (excluded from our re-signing), and MotionBrief never sets `CLAUDE_CONFIG_DIR`, so it shares the user's Claude Code login.
