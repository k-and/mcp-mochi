#!/usr/bin/env bash
#
# scripts/release.sh - release to npm and GitHub in one go
#
# Usage:   scripts/release.sh <version>
# Example: scripts/release.sh 1.0.0
#
# Preconditions (checked before anything is published or pushed):
#   - package.json version matches <version>
#   - Tag v<version> exists locally (git tag v<version>)
#   - CHANGELOG.md contains a [<version>] entry
#   - npm is logged in (npm whoami)
#   - gh is logged in (gh auth status)
#   - Build passes
#
# Steps:
#   1. Publish to npm
#   2. Push current branch and tag to origin
#   3. Create GitHub Release with notes extracted from the CHANGELOG entry
#
# Why publish before push: publishing first hides the "npx command 404"
# window on the more-visible surface (README users running the install).
# The repository-link 404 on npmjs.com is less visible and closes quickly
# when push completes.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <version>  (e.g. $0 1.0.0)" >&2
  exit 1
fi

VERSION="$1"
TAG="v${VERSION}"
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "==> Releasing ${TAG}"

# --- Preconditions -----------------------------------------------------------

echo "==> Checking preconditions"

PKG_VERSION=$(node -p "require('./package.json').version")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "ERROR: package.json version ($PKG_VERSION) does not match ${VERSION}" >&2
  exit 1
fi

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: tag ${TAG} does not exist locally. Create it first: git tag ${TAG}" >&2
  exit 1
fi

if ! grep -q "^## \[${VERSION}\]" CHANGELOG.md; then
  echo "ERROR: no [${VERSION}] entry in CHANGELOG.md" >&2
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "ERROR: not logged in to npm. Run 'npm login' first." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: not logged in to gh. Run 'gh auth login' first." >&2
  exit 1
fi

echo "==> Running build"
npm run build

# --- Extract CHANGELOG section for release notes -----------------------------
# Matches everything between "## [<version>]" and either the next "## [" or
# the link reference "[<version>]:". Excludes the version header line itself.

NOTES=$(awk -v ver="${VERSION}" '
  $0 ~ "^## \\[" ver "\\]"          { flag=1; next }
  $0 ~ "^## \\["                    { flag=0 }
  $0 ~ "^\\[" ver "\\]:"            { flag=0 }
  flag
' CHANGELOG.md)

if [[ -z "$NOTES" ]]; then
  echo "ERROR: extracted release notes are empty" >&2
  exit 1
fi

# --- Publish to npm ----------------------------------------------------------

echo "==> Publishing to npm"
npm publish --access=public

# --- Push branch + tag -------------------------------------------------------

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "==> Pushing ${BRANCH} and ${TAG} to origin"
git push -u origin "$BRANCH"
git push origin "$TAG"

# --- Create GitHub Release ---------------------------------------------------

echo "==> Creating GitHub Release"
gh release create "$TAG" \
  --title "$TAG" \
  --notes "$NOTES"

# --- Summary -----------------------------------------------------------------

PKG_NAME=$(node -p "require('./package.json').name")
REPO_URL=$(gh repo view --json url -q .url)

echo
echo "==> Release ${TAG} complete"
echo "    npm:    https://www.npmjs.com/package/${PKG_NAME}"
echo "    github: ${REPO_URL}/releases/tag/${TAG}"
