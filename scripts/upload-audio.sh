#!/usr/bin/env bash
#
# Upload the recitation audio to a GitHub Release.
#
# The full recitation is ~3 GB — too large for a git clone and larger than a
# Vercel deployment accepts. Release assets are stored outside the repository
# and served over GitHub's CDN, so the clone stays small.
#
# Assets are flat: `SSSAAA.mp3` (3-digit surah + 3-digit ayah), which is
# globally unique. lib/data/audioUrl.ts resolves a stored path to
# NEXT_PUBLIC_AUDIO_BASE_URL + filename to match.
#
# Usage:
#   ./scripts/upload-audio.sh            # upload everything not already there
#   ./scripts/upload-audio.sh --clobber  # re-upload and overwrite
#
set -euo pipefail

REPO="${AUDIO_REPO:-umairnawaz333/quran-recite}"
TAG="${AUDIO_TAG:-audio-v1}"
SRC="public/audio/abdulbasit-murattal"
BATCH=40
CLOBBER="${1:-}"

[ -d "$SRC" ] || { echo "error: $SRC missing — run the fetch first" >&2; exit 1; }

command -v gh >/dev/null || { echo "error: gh CLI not found" >&2; exit 1; }

gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 || {
  echo "Creating release $TAG"
  gh release create "$TAG" --repo "$REPO" \
    --title "Recitation audio (AbdulBaset AbdulSamad, Murattal)" \
    --notes "Per-ayah MP3 files named SSSAAA.mp3. Source: Quran.com API v4, copied byte-for-byte."
}

# Skip files already uploaded unless --clobber, so an interrupted run resumes
# instead of starting over.
existing=$(mktemp)
gh release view "$TAG" --repo "$REPO" --json assets \
  --jq '.assets[].name' 2>/dev/null | sort > "$existing" || true
echo "Already uploaded: $(wc -l < "$existing" | tr -d ' ')"

pending=$(mktemp)
if [ "$CLOBBER" = "--clobber" ]; then
  find "$SRC" -name '*.mp3' | sort > "$pending"
else
  find "$SRC" -name '*.mp3' | sort | while read -r f; do
    grep -qxF "$(basename "$f")" "$existing" || echo "$f"
  done > "$pending"
fi

total=$(wc -l < "$pending" | tr -d ' ')
echo "To upload: $total"
[ "$total" -eq 0 ] && { echo "Nothing to do."; exit 0; }

# xargs batches the uploads: one gh invocation per BATCH files rather than per
# file, which is roughly 3x faster on a set this size.
tr '\n' '\0' < "$pending" | xargs -0 -n "$BATCH" sh -c '
  gh release upload "'"$TAG"'" --repo "'"$REPO"'" --clobber "$@" >/dev/null 2>&1 \
    && echo "  uploaded $# files" \
    || echo "  FAILED batch of $# — rerun to retry"
' _

echo
echo "Done. Verify:"
echo "  curl -sIL https://github.com/$REPO/releases/download/$TAG/001001.mp3 | head -1"
echo
echo "Then point the app at it:"
echo "  NEXT_PUBLIC_AUDIO_BASE_URL=https://github.com/$REPO/releases/download/$TAG"

rm -f "$existing" "$pending"
