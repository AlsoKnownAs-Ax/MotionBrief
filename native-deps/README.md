# native-deps

Builds the native executables MotionBrief ships but nobody publishes in the form we need (ADR 0002):

- **whisper-cli** from a pinned whisper.cpp tag. macOS arm64 is one static binary with Metal and its shaders embedded. Windows x64 is `whisper-cli.exe` with ggml backend DLLs loaded at runtime (`GGML_BACKEND_DL`): Vulkan when the machine has a GPU and a Vulkan loader, otherwise the best CPU variant. The MSVC runtime DLLs ship alongside it.
- **FFmpeg and FFprobe**: a minimal GPL build (GPL version 2 or later) statically linked against zlib, libx264 and libx265, for both platforms. The macOS build also enables VideoToolbox.

The `native-deps` workflow (`.github/workflows/native-deps.yml`) runs these scripts on native runners (`macos-15` arm64, `windows-2025`).

| Script | Does |
|---|---|
| `versions.env` | Every pin: tags and commits for git sources, URLs and our own SHA-256 for tarballs. |
| `fetch-sources.sh` | Downloads and verifies all sources into one folder. |
| `build-whisper.sh` | Builds whisper-cli from that folder. |
| `build-ffmpeg.sh` | Builds zlib, x264, x265 and FFmpeg from that folder. On Windows it runs in MSYS2 UCRT64. |
| `smoke.sh` | On a clean runner: `--version`, tiny libx264/libx265 transcodes, and a tiny transcription with DTW word timings. |

## Publishing a release

1. Change the pins in `versions.env` and push. The workflow builds and smoke-tests on every push that touches this folder.
2. Run the workflow manually from `main` with a new `release_tag`, such as `native-deps-2`.
3. The release holds:
   - `whisper-cli-<tag>-<platform>.zip`
   - `ffmpeg-<version>-<platform>.zip`
   - `native-deps-source.tar`, the complete corresponding source plus these scripts
   - `SHA256SUMS.txt`

   It isn't marked as the latest release, so the app's updater ignores it.
4. Re-pin the app's dependency manifest to the new assets.

Releases are immutable: never delete or replace one that an app release references. GPL compliance depends on its source archive staying available.
