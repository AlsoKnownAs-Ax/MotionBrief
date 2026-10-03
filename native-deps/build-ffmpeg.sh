#!/usr/bin/env bash
# Usage: build-ffmpeg.sh <mac-arm64|win-x64> <sources-dir> <out-dir>
#
# Builds a minimal GPL FFmpeg and FFprobe, statically linked against zlib,
# libx264 and libx265, from the pinned sources, and writes
# ffmpeg-<version>-<platform>.zip to <out-dir>.
#
# mac-arm64 runs in the system bash with Xcode's clang, cmake and pkg-config.
# win-x64 runs in an MSYS2 UCRT64 shell with gcc, nasm, cmake, make and
# pkgconf; the binaries link the MinGW runtime statically, so they depend only
# on DLLs that ship with Windows.

. "$(dirname "$0")/lib.sh"

platform="${1:?usage: build-ffmpeg.sh <mac-arm64|win-x64> <sources-dir> <out-dir>}"
sources="$(cd "${2:?missing sources-dir}" && pwd)"
mkdir -p "${3:?missing out-dir}"
out="$(cd "$3" && pwd)"

work="$(mktemp -d)"
prefix="$work/prefix"
pkg="$work/pkg"
mkdir -p "$prefix" "$pkg"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"

case "$platform" in
  mac-arm64)
    jobs="$(sysctl -n hw.ncpu)"
    cmake_generator="Unix Makefiles"
    # x265 is C++; FFmpeg links it as a C library and needs the runtime.
    cxx_runtime="-lc++"
    exe=""
    ffmpeg_platform_flags=(
      --enable-pthreads
      --enable-videotoolbox
      --enable-audiotoolbox
      --extra-ldflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
    )
    ;;
  win-x64)
    is_windows || die "win-x64 builds run in an MSYS2 UCRT64 shell"
    jobs="$NUMBER_OF_PROCESSORS"
    cmake_generator="MSYS Makefiles"
    cxx_runtime="-lstdc++"
    exe=".exe"
    ffmpeg_platform_flags=(
      --enable-w32threads
      --extra-ldflags="-static"
    )
    ;;
  *)
    die "unknown platform: $platform"
    ;;
esac

unpack() {
  tar -xzf "$sources/$1" -C "$work"
}

log "Building zlib $ZLIB_VERSION"
unpack "$ZLIB_SRC_TARBALL"
(
  cd "$work/zlib-$ZLIB_VERSION"
  if [ "$platform" = win-x64 ]; then
    # SHARED_MODE=0 installs only the static library and headers.
    make -f win32/Makefile.gcc -j "$jobs" install SHARED_MODE=0 \
      INCLUDE_PATH="$prefix/include" LIBRARY_PATH="$prefix/lib" BINARY_PATH="$prefix/bin"
  else
    ./configure --static --prefix="$prefix"
    make -j "$jobs" install
  fi
)

log "Building x264 $X264_COMMIT"
unpack "$X264_SRC_TARBALL"
(
  cd "$work/x264-$X264_COMMIT"
  ./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli
  make -j "$jobs" install
)

log "Building x265 $X265_VERSION"
unpack "$X265_SRC_TARBALL"
(
  x265_src="$(find "$work" -maxdepth 1 -type d -name 'x265*' | head -n 1)"
  # x265's CMakeLists predates CMake 3.5, which CMake 4 refuses without
  # CMAKE_POLICY_VERSION_MINIMUM.
  cmake -S "$x265_src/source" -B "$work/x265-build" -G "$cmake_generator" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DENABLE_SHARED=OFF \
    -DENABLE_CLI=OFF
  cmake --build "$work/x265-build" -j "$jobs"
  cmake --install "$work/x265-build"
  # x265.pc lists the compiler's shared runtime (-lgcc_s and friends), which
  # can't link statically; FFmpeg only needs the C++ standard library.
  sed -i.bak "s|^Libs.private:.*|Libs.private: $cxx_runtime -lm|" "$prefix/lib/pkgconfig/x265.pc"
)

log "Building FFmpeg $FFMPEG_VERSION"
tar -xJf "$sources/$FFMPEG_SRC_TARBALL" -C "$work"
ffmpeg_src="$work/ffmpeg-$FFMPEG_VERSION"
ffmpeg_flags=(
  --prefix="$prefix"
  --pkg-config-flags=--static
  --extra-cflags="-I$prefix/include"
  --extra-ldflags="-L$prefix/lib"
  --disable-autodetect
  --disable-shared
  --enable-static
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-network
  --enable-gpl
  --enable-zlib
  --enable-libx264
  --enable-libx265
  "${ffmpeg_platform_flags[@]}"
)
(
  cd "$ffmpeg_src"
  ./configure "${ffmpeg_flags[@]}" || {
    tail -n 80 ffbuild/config.log
    exit 1
  }
  make -j "$jobs"
  make install
)

cp "$prefix/bin/ffmpeg$exe" "$prefix/bin/ffprobe$exe" "$pkg/"
cp "$ffmpeg_src/COPYING.GPLv2" "$pkg/COPYING.GPLv2.txt"
cat > "$pkg/BUILDINFO.txt" << EOF
FFmpeg $FFMPEG_VERSION for $platform, licensed under the GNU GPL version 2 or later.

Statically linked:
  zlib $ZLIB_VERSION
  x264 $X264_COMMIT
  x265 $X265_VERSION

The complete corresponding source (every tarball above) and the build script
(native-deps/build-ffmpeg.sh) are attached to the same GitHub Release as this
binary, in the source archive.

configure ${ffmpeg_flags[*]}
EOF

zip_dir "$pkg" "$out/ffmpeg-$FFMPEG_VERSION-$platform.zip"
log "Packaged:"
ls -l "$pkg"
rm -rf "$work"
