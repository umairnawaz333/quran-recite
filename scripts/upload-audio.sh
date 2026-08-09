#!/usr/bin/env bash
#
# Upload the recitation audio to GitHub Releases, one release per surah.
#
# The full recitation is ~3 GB across 6,236 files — too large for a git clone
# and larger than a Vercel deployment accepts. Release assets live outside the
# repository and are served over GitHub's CDN.
#
# Why one release per surah: GitHub caps a release at 1000 assets
# ("file_count limited to 1000 assets per release"), and Al-Baqarah alone has
# 286 ayahs. Sharding by surah keeps every release well under the cap and
# makes the shard derivable from the filename, so lib/data/audioUrl.ts needs
# no lookup table:
#
#   002255.mp3  ->  release audio-002  ->  {BASE}/audio-002/002255.mp3
#
# The script is resumable: assets already present are skipped, so it can be
# re-run while a fetch is still downloading, and again afterwards to sweep up.
#
# Usage:
#   ./scripts/upload-audio.sh          # all surahs present on disk
#   ./scripts/upload-audio.sh 2 3 4    # only these surahs
#
set -uo pipefail

REPO="${AUDIO_REPO:-umairnawaz333/quran-recite}"
SRC="public/audio/abdulbasit-murattal"
BATCH=40

[ -d "$SRC" ] || { echo "error: $SRC missing — run the fetch first" >&2; exit 1; }
command -v gh >/dev/null || { echo "error: gh CLI not found" >&2; exit 1; }

# Which surahs to process: explicit arguments, or every surah with files.
if [ "$#" -gt 0 ]; then
  surahs=$(printf '%03d\n' "$@")
else
  surahs=$(ls "$SRC"/*.mp3 2>/dev/null | xargs -n1 basename | cut -c1-3 | sort -u)
fi

total_uploaded=0
total_skipped=0
failed_surahs=""

for s in $surahs; do
  files=$(ls "$SRC/${s}"*.mp3 2>/dev/null || true)
  [ -z "$files" ] && continue
  count=$(echo "$files" | wc -l | tr -d ' ')
  tag="audio-${s}"

  if ! gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then
    gh release create "$tag" --repo "$REPO" \
      --title "Surah ${s#00} audio — AbdulBaset AbdulSamad (Murattal)" \
      --notes "Per-ayah MP3 files for surah ${s#00}, named SSSAAA.mp3. Source: Quran.com API v4, copied byte-for-byte." \
      >/dev/null 2>&1 || { echo "surah $s: could not create release"; failed_surahs="$failed_surahs $s"; continue; }
  fi

  existing=$(gh release view "$tag" --repo "$REPO" --json assets --jq '.assets[].name' 2>/dev/null | sort)
  pending=$(for f in $files; do
    echo "$existing" | grep -qxF "$(basename "$f")" || echo "$f"
  done)

  if [ -z "$pending" ]; then
    echo "surah $s: all $count already uploaded"
    total_skipped=$((total_skipped + count))
    continue
  fi

  n=$(echo "$pending" | wc -l | tr -d ' ')
  echo "surah $s: uploading $n of $count"

  if echo "$pending" | tr '\n' '\0' | xargs -0 -n "$BATCH" \
       gh release upload "$tag" --repo "$REPO" --clobber >/dev/null 2>&1; then
    total_uploaded=$((total_uploaded + n))
  else
    echo "surah $s: FAILED — re-run to retry"
    failed_surahs="$failed_surahs $s"
  fi
done

echo
echo "uploaded: $total_uploaded   already present: $total_skipped"
[ -n "$failed_surahs" ] && echo "failed surahs:$failed_surahs (re-run to retry)"

echo
echo "Point the app at the releases with:"
echo "  NEXT_PUBLIC_AUDIO_BASE_URL=https://github.com/$REPO/releases/download"
