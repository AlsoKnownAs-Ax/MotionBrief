#!/usr/bin/env bash
# Usage: smoke.sh <mac-arm64|win-x64> <dist-dir> <sources-dir>
#
# Unpacks the release zips from <dist-dir> and runs each binary: --version,
# a tiny transcode through libx264 and libx265, and a tiny transcription with
# word timings. Run it on a clean runner of the target platform, so a missing
# runtime dependency fails here rather than on a user's machine.

. "$(dirname "$0")/lib.sh"

platform="${1:?usage: smoke.sh <mac-arm64|win-x64> <dist-dir> <sources-dir>}"
dist="$(cd "${2:?missing dist-dir}" && pwd)"
sources="$(cd "${3:?missing sources-dir}" && pwd)"

work="$(mktemp -d)"
unzip_to "$dist/ffmpeg-$FFMPEG_VERSION-$platform.zip" "$work/ffmpeg"
unzip_to "$dist/whisper-cli-$WHISPER_CPP_TAG-$platform.zip" "$work/whisper"

exe=""
[ "$platform" = win-x64 ] && exe=".exe"

# Git Bash puts MinGW DLLs on PATH, which would hide a missing static link,
# so on Windows the binaries run with only the Windows folders on PATH.
isolated() {
  if is_windows; then
    PATH="/c/Windows/System32:/c/Windows" "$@"
  else
    "$@"
  fi
}
ffmpeg() { isolated "$work/ffmpeg/ffmpeg$exe" "$@"; }
ffprobe() { isolated "$work/ffmpeg/ffprobe$exe" "$@"; }
whisper() { isolated "$work/whisper/whisper-cli$exe" "$@"; }

if [ "$platform" = mac-arm64 ]; then
  log "Checking that only system libraries are linked"
  for bin in "$work/ffmpeg/ffmpeg" "$work/ffmpeg/ffprobe" "$work/whisper/whisper-cli"; do
    otool -L "$bin"
    if otool -L "$bin" | tail -n +2 | grep -Ev '^[[:space:]]+(/usr/lib/|/System/Library/)'; then
      die "$(basename "$bin") links a non-system library"
    fi
  done
fi

log "ffmpeg -version"
ffmpeg -hide_banner -version
ffprobe_version="$(ffprobe -hide_banner -version)"
echo "${ffprobe_version%%$'\n'*}"

encoders="$(ffmpeg -hide_banner -encoders)"
for encoder in libx264 libx265; do
  grep -q " $encoder " <<< "$encoders" || die "ffmpeg lacks the $encoder encoder"
done

# expect_codec <file> <codec>
expect_codec() {
  local codec
  codec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1" | tr -d '\r')"
  [ "$codec" = "$2" ] || die "$1 has video codec '$codec', expected '$2'"
  echo "$(basename "$1"): $codec"
}

log "Tiny transcodes"
cd "$work"
for pair in libx264:h264 libx265:hevc; do
  encoder="${pair%%:*}"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i testsrc2=size=320x240:rate=30:duration=1 \
    -f lavfi -i sine=frequency=440:duration=1 \
    -c:v "$encoder" -pix_fmt yuv420p -c:a aac -shortest "$encoder.mp4"
  expect_codec "$encoder.mp4" "${pair##*:}"
done

# The way HyperFrames encodes: PNG frames piped into ffmpeg's stdin.
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x240:rate=30 \
  -frames:v 15 -c:v png -f image2pipe - |
  ffmpeg -hide_banner -loglevel error -y -f image2pipe -c:v png -framerate 30 -i - \
    -c:v libx264 -pix_fmt yuv420p piped.mp4
expect_codec piped.mp4 h264

log "whisper-cli --version"
version="$(whisper --version)"
echo "$version"
grep -q "${WHISPER_CPP_TAG#v}" <<< "$version" || die "whisper-cli reports '$version', expected $WHISPER_CPP_TAG"

log "Tiny transcription"
fetch_verified "$SMOKE_MODEL_URL" "$SMOKE_MODEL_SHA256" "$work/model.bin"
tar -xzf "$sources/$WHISPER_SRC_TARBALL" -C "$work" "whisper.cpp-$WHISPER_CPP_TAG/samples/jfk.wav"
whisper -m model.bin -f "whisper.cpp-$WHISPER_CPP_TAG/samples/jfk.wav" -l en \
  --dtw tiny.en -ojf -of transcript 2> whisper.log || {
  cat whisper.log
  die "whisper-cli failed"
}
cat whisper.log
grep -qi "country" transcript.json || die "transcript doesn't contain the expected words"
grep -q '"t_dtw"' transcript.json || die "transcript has no DTW word timings"

if [ "$platform" = win-x64 ]; then
  # Runners have no GPU, so this proves the CPU fallback of GGML_BACKEND_DL.
  if [ -f /c/Windows/System32/vulkan-1.dll ]; then
    echo "This runner has a Vulkan loader but no GPU."
  else
    echo "This runner has no Vulkan loader."
  fi
  grep -q "loaded CPU backend" whisper.log || die "whisper-cli didn't load a CPU backend"
else
  grep -q "found GPU device.*MTL" whisper.log || die "whisper-cli didn't run on Metal"
fi

log "Smoke test passed for $platform"
cd /
rm -rf "$work"
