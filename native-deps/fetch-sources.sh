#!/usr/bin/env bash
# Usage: fetch-sources.sh <out-dir>
#
# Downloads every pinned upstream source into <out-dir> and verifies it.
# The build scripts build only from these files, and the release publishes
# them unchanged, so the published source is exactly what was built.

. "$(dirname "$0")/lib.sh"

out="${1:?usage: fetch-sources.sh <out-dir>}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

fetch_verified "$FFMPEG_URL" "$FFMPEG_SHA256" "$out/$FFMPEG_SRC_TARBALL"
fetch_verified "$X265_URL" "$X265_SHA256" "$out/$X265_SRC_TARBALL"
fetch_verified "$ZLIB_URL" "$ZLIB_SHA256" "$out/$ZLIB_SRC_TARBALL"

# archive_git <repo> <ref> <commit> <prefix> <tarball>: snapshots a git source,
# refusing it if <ref> doesn't resolve to the pinned commit.
archive_git() {
  local repo="$1" ref="$2" commit="$3" prefix="$4" tarball="$5"
  local clone
  clone="$(mktemp -d)"
  log "Cloning $repo at $ref"
  git -C "$clone" init --quiet
  git -C "$clone" fetch --quiet --depth 1 "$repo" "$ref"
  local actual
  actual="$(git -C "$clone" rev-parse 'FETCH_HEAD^{commit}')"
  [ "$actual" = "$commit" ] || die "$repo $ref is $actual, expected $commit"
  git -C "$clone" archive --format=tar.gz --prefix="$prefix/" -o "$out/$tarball" "$commit"
  rm -rf "$clone"
}

archive_git "$WHISPER_CPP_REPO" "refs/tags/$WHISPER_CPP_TAG" "$WHISPER_CPP_COMMIT" \
  "whisper.cpp-$WHISPER_CPP_TAG" "$WHISPER_SRC_TARBALL"
archive_git "$X264_REPO" "$X264_COMMIT" "$X264_COMMIT" \
  "x264-$X264_COMMIT" "$X264_SRC_TARBALL"

log "Sources in $out"
ls -l "$out"
