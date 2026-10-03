#!/usr/bin/env bash
# Usage: build-whisper.sh <mac-arm64|win-x64> <sources-dir> <out-dir>
#
# Builds whisper-cli from the pinned whisper.cpp source and writes
# whisper-cli-<tag>-<platform>.zip to <out-dir>.
#
# mac-arm64: one static binary with Metal, shaders embedded.
# win-x64:   whisper-cli.exe plus ggml backend DLLs loaded at runtime
#            (GGML_BACKEND_DL): Vulkan when a GPU and loader are present,
#            otherwise the best CPU variant for the machine. Needs the
#            Vulkan SDK (VULKAN_SDK) and Visual Studio.

. "$(dirname "$0")/lib.sh"

platform="${1:?usage: build-whisper.sh <mac-arm64|win-x64> <sources-dir> <out-dir>}"
sources="$(cd "${2:?missing sources-dir}" && pwd)"
mkdir -p "${3:?missing out-dir}"
out="$(cd "$3" && pwd)"

work="$(mktemp -d)"
tar -xzf "$sources/$WHISPER_SRC_TARBALL" -C "$work"
src="$work/whisper.cpp-$WHISPER_CPP_TAG"
build="$work/build"
pkg="$work/pkg"
mkdir -p "$pkg"

common_flags=(
  -DCMAKE_BUILD_TYPE=Release
  -DGGML_NATIVE=OFF
  -DWHISPER_BUILD_TESTS=OFF
  -DWHISPER_BUILD_SERVER=OFF
  -DWHISPER_SDL2=OFF
  -DWHISPER_CURL=OFF
)

case "$platform" in
  mac-arm64)
    log "Configuring whisper.cpp $WHISPER_CPP_TAG for macOS arm64 (Metal)"
    cmake -S "$src" -B "$build" "${common_flags[@]}" \
      -DCMAKE_OSX_ARCHITECTURES=arm64 \
      -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET" \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_METAL=ON \
      -DGGML_METAL_EMBED_LIBRARY=ON
    cmake --build "$build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)"
    cp "$build/bin/whisper-cli" "$pkg/"
    ;;
  win-x64)
    [ -n "${VULKAN_SDK:-}" ] || die "VULKAN_SDK is not set; install the Vulkan SDK first"
    log "Configuring whisper.cpp $WHISPER_CPP_TAG for Windows x64 (Vulkan + CPU, GGML_BACKEND_DL)"
    cmake -S "$(native_path "$src")" -B "$(native_path "$build")" -A x64 "${common_flags[@]}" \
      -DBUILD_SHARED_LIBS=ON \
      -DGGML_BACKEND_DL=ON \
      -DGGML_CPU_ALL_VARIANTS=ON \
      -DGGML_VULKAN=ON
    # With GGML_BACKEND_DL the ggml target depends on every backend DLL, so
    # this also builds the Vulkan backend and all CPU variants.
    cmake --build "$(native_path "$build")" --config Release --target whisper-cli -j "$NUMBER_OF_PROCESSORS"
    bin_dir="$build/bin/Release"
    [ -f "$bin_dir/ggml-vulkan.dll" ] || die "the Vulkan backend wasn't built"
    cp "$bin_dir/whisper-cli.exe" "$bin_dir/whisper.dll" "$bin_dir/"ggml*.dll "$pkg/"

    # Ship the MSVC runtime next to the binaries (app-local deployment), so
    # machines without the VC++ Redistributable can run them.
    vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
    for component in CRT OpenMP; do
      redist="$("$vswhere" -latest -find "VC/Redist/MSVC/*/x64/Microsoft.VC*.$component" | grep -v onecore | head -n 1 | tr -d '\r')"
      [ -n "$redist" ] || die "MSVC $component redistributable not found"
      cp "$(cygpath "$redist")"/*.dll "$pkg/"
    done
    ;;
  *)
    die "unknown platform: $platform"
    ;;
esac

cp "$src/LICENSE" "$pkg/LICENSE-whisper.cpp.txt"
cat > "$pkg/BUILDINFO.txt" << EOF
whisper.cpp $WHISPER_CPP_TAG ($WHISPER_CPP_COMMIT), built for $platform
Source: $WHISPER_SRC_TARBALL in the release's source archive.
Build script: native-deps/build-whisper.sh in the same archive.
EOF

zip_dir "$pkg" "$out/whisper-cli-$WHISPER_CPP_TAG-$platform.zip"
log "Packaged:"
ls -l "$pkg"
rm -rf "$work"
