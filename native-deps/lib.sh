# shellcheck shell=bash
# shellcheck disable=SC2034 # the variables below are used by the scripts that source this
# Shared helpers for the native-deps scripts. Source it; don't run it.
# Works in macOS bash 3.2, Git Bash and MSYS2.

set -euo pipefail

NATIVE_DEPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
. "$NATIVE_DEPS_DIR/versions.env"
export MACOSX_DEPLOYMENT_TARGET

log() {
  printf '\n==> %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

is_windows() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# fetch_verified <url> <sha256> <dest>: downloads once and refuses a mismatch.
fetch_verified() {
  local url="$1" expected="$2" dest="$3"
  if [ ! -f "$dest" ]; then
    log "Fetching $url"
    curl --fail --silent --show-error --location --retry 5 --retry-all-errors \
      --output "$dest.part" "$url"
    mv "$dest.part" "$dest"
  fi
  local actual
  actual="$(sha256_of "$dest")"
  if [ "$actual" != "$expected" ]; then
    rm -f "$dest"
    die "SHA-256 mismatch for $url: expected $expected, got $actual"
  fi
}

# bsdtar can write and read zip on both platforms: /usr/bin/tar on macOS and
# System32\tar.exe on Windows. GNU tar from Git Bash or MSYS2 can't.
bsdtar() {
  if is_windows; then
    "$(cygpath "${SYSTEMROOT:-C:\\Windows}")/System32/tar.exe" "$@"
  else
    /usr/bin/tar "$@"
  fi
}

# zip_dir <dir> <out.zip>: zips the contents of dir, keeping file modes.
zip_dir() {
  local out
  out="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
  rm -f "$out"
  (cd "$1" && bsdtar -a -cf "$(native_path "$out")" ./*)
}

unzip_to() {
  mkdir -p "$2"
  bsdtar -xf "$(native_path "$1")" -C "$(native_path "$2")"
}

# Paths handed to native Windows programs need the C:/ form.
native_path() {
  if is_windows; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

# Tarball names, shared by fetch-sources.sh, the build scripts and the release.
WHISPER_SRC_TARBALL="whisper.cpp-$WHISPER_CPP_TAG.tar.gz"
X264_SRC_TARBALL="x264-$X264_COMMIT.tar.gz"
FFMPEG_SRC_TARBALL="$(basename "$FFMPEG_URL")"
X265_SRC_TARBALL="$(basename "$X265_URL")"
ZLIB_SRC_TARBALL="$(basename "$ZLIB_URL")"
