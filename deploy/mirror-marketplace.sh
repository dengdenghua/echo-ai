#!/usr/bin/env bash
# Mirror the signed `echo-content` release to https://ai.echo-age.com/marketplace/.
#
# Run it after "Publish signed plugin content" succeeds. It downloads the release,
# checks the archives against their .sha256 files, uploads everything into a
# staging folder next to (not inside) the served tree, re-checks the hashes on the
# server, then moves the files into place: content first, catalogs last, each as
# an atomic rename on the same filesystem, so a client never reads a catalog that
# names an archive the mirror does not have yet. Files from older releases are
# kept, so a client mid-update can still finish.
#
# Needs: `gh` signed in, and the SSH alias below as the deploy user, which owns
# the marketplace folder (it has no sudo and needs none).
#
#   bash deploy/mirror-marketplace.sh            # mirror the current release
#   ECHO_MARKETPLACE_DRY_RUN=1 bash deploy/...   # download and verify only
set -euo pipefail

REPO="${ECHO_CONTENT_REPO:-dengdenghua/workbuddy-expert-market}"
TAG="${ECHO_CONTENT_TAG:-echo-content}"
HOST="${ECHO_MARKETPLACE_HOST:-echo-prod}"
DEST="${ECHO_MARKETPLACE_DIR:-/var/www/echo/marketplace}"
STAGE_ROOT="${ECHO_MARKETPLACE_STAGE_ROOT:-/var/www/echo-universe}"
URL="${ECHO_MARKETPLACE_URL:-https://ai.echo-age.com/marketplace}"
CATALOGS='plugin-store*.json skill-registry*.json'

work="$(mktemp -d "${TMPDIR:-/tmp}/echo-marketplace.XXXXXX")"
trap 'rm -rf "$work"' EXIT

echo "downloading $REPO@$TAG"
gh release download "$TAG" -R "$REPO" -D "$work" --clobber
cd "$work"
for archive in echo-plugins.tar.gz echo-skills.tar.gz; do
  want="$(cut -d' ' -f1 "$archive.sha256")"
  got="$(sha256sum "$archive" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { echo "hash mismatch: $archive" >&2; exit 1; }
done
sha256sum -- * > SHA256SUMS
echo "verified $(($(wc -l < SHA256SUMS))) files"

if [ -n "${ECHO_MARKETPLACE_DRY_RUN:-}" ]; then
  echo "dry run: nothing uploaded"
  exit 0
fi

stage="$STAGE_ROOT/.marketplace-incoming-$(date +%Y%m%d%H%M%S)"
ssh -o BatchMode=yes "$HOST" "mkdir -p '$stage'"
scp -o BatchMode=yes -q -- * "$HOST:$stage/"
ssh -o BatchMode=yes "$HOST" bash -s -- "$stage" "$DEST" "$CATALOGS" <<'REMOTE'
set -euo pipefail
stage="$1"; dest="$2"; catalogs="$3"
cd "$stage"
sha256sum --quiet -c SHA256SUMS
rm SHA256SUMS
is_catalog() { for pattern in $catalogs; do case "$1" in $pattern) return 0 ;; esac; done; return 1; }
for f in *; do is_catalog "$f" || mv -f -- "$f" "$dest/$f"; done
for f in *; do mv -f -- "$f" "$dest/$f"; done
cd / && rmdir "$stage"
REMOTE

# The served catalogs must now be the release's catalogs.
for f in plugin-store.json skill-registry.json plugin-publishers.json; do
  want="$(sha256sum "$f" | cut -d' ' -f1)"
  got="$(curl -fsS --max-time 60 "$URL/$f" | sha256sum | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { echo "served $f does not match the release" >&2; exit 1; }
done
echo "mirrored to $URL"
