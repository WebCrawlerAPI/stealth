#!/bin/sh
# Install @webcrawlerapi/stealth without npm.
#
# Downloads the single-file module from the private GitHub repo over HTTPS.
#
#   GH_TOKEN=ghp_xxx sh install.sh [output-path]
#
# output-path defaults to ./stealth.js
set -eu

REPO="WebCrawlerAPI/stealth"
REF="${STEALTH_REF:-main}"
OUT="${1:-stealth.js}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

url="https://api.github.com/repos/$REPO/contents/stealth.js?ref=$REF"

if [ -n "${TOKEN}" ]; then
  curl -fsSL \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github.raw" \
    "$url" -o "$OUT"
else
  # Only works if the repository is public.
  curl -fsSL -H "Accept: application/vnd.github.raw" "$url" -o "$OUT"
fi

echo "wrote $OUT"
