#!/usr/bin/env bash
#
# Upload the recitation audio to Cloudflare R2.
#
# R2 is S3-compatible, so the AWS CLI works against it with an endpoint
# override — no Cloudflare-specific tooling required.
#
# Setup, once:
#   1. Create an R2 bucket in the Cloudflare dashboard
#   2. Create an R2 API token with Object Read & Write
#   3. aws configure --profile r2        (enter the R2 access key and secret)
#   4. Enable the bucket's Public Development URL
#
# Usage:
#   R2_ACCOUNT_ID=<id> R2_BUCKET=<bucket> ./scripts/upload-audio.sh
#
set -euo pipefail

: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID (Cloudflare dashboard > R2 > account ID)}"
: "${R2_BUCKET:?Set R2_BUCKET (the bucket name)}"
PROFILE="${R2_PROFILE:-r2}"
SRC="public/audio"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

if [ ! -d "$SRC" ]; then
  echo "error: $SRC does not exist — run 'npm run fetch:data -- --surahs=1-114' first" >&2
  exit 1
fi

files=$(find "$SRC" -name '*.mp3' | wc -l | tr -d ' ')
size=$(du -sh "$SRC" | cut -f1)
echo "Uploading $files files ($size) to r2://$R2_BUCKET/audio/"
echo "Endpoint: $ENDPOINT"
echo

# These files are content-addressed by surah and ayah number and never change,
# so they can be cached indefinitely.
aws s3 sync "$SRC" "s3://${R2_BUCKET}/audio" \
  --profile "$PROFILE" \
  --endpoint-url "$ENDPOINT" \
  --content-type audio/mpeg \
  --cache-control "public, max-age=31536000, immutable" \
  --size-only \
  --no-progress

echo
echo "Done. Verify one file is publicly reachable:"
echo "  curl -sI <public-r2-url>/audio/abdulbasit-murattal/001001.mp3 | head -1"
echo
echo "Then point the app at it:"
echo "  vercel env add NEXT_PUBLIC_AUDIO_BASE_URL production"
