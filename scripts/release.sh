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
EXPECTED_BRANCH="${RELEASE_BRANCH:-main}"
REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "==> Releasing ${TAG}"

# --- Preconditions -----------------------------------------------------------

echo "==> Checking preconditions"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: must be on '$EXPECTED_BRANCH' to release (currently on '$CURRENT_BRANCH')" >&2
  echo "       Hotfix override: RELEASE_BRANCH=<name> $0 $VERSION" >&2
  exit 1
fi

PKG_VERSION=$(node -p "require('./package.json').version")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "ERROR: package.json version ($PKG_VERSION) does not match ${VERSION}" >&2
  exit 1
fi

if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: tag ${TAG} does not exist locally. Create it first: git tag ${TAG}" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$TAG" HEAD; then
  echo "ERROR: tag ${TAG} is not reachable from HEAD of $CURRENT_BRANCH" >&2
  echo "       Either retag at the right commit or check out the branch that contains it." >&2
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

# Extract the owner/name slug from the origin remote URL so gh release
# targets our fork explicitly. Without this, gh defaults to the parent
# repo on forks and the release creation fails with "tag has not been
# pushed to <upstream>".
ORIGIN_URL=$(git remote get-url origin)
REPO_SLUG=$(echo "$ORIGIN_URL" | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
if [[ -z "$REPO_SLUG" ]] || [[ "$REPO_SLUG" == "$ORIGIN_URL" ]]; then
  echo "ERROR: could not derive owner/repo slug from origin URL: $ORIGIN_URL" >&2
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

echo "==> Pushing ${CURRENT_BRANCH} and ${TAG} to origin"
git push -u origin "$CURRENT_BRANCH"
git push origin "$TAG"

# --- Create GitHub Release ---------------------------------------------------

echo "==> Creating GitHub Release on ${REPO_SLUG}"
gh release create "$TAG" \
  --repo "$REPO_SLUG" \
  --title "$TAG" \
  --notes "$NOTES"

# --- Summary -----------------------------------------------------------------

PKG_NAME=$(node -p "require('./package.json').name")

echo
echo "==> Release ${TAG} complete"
echo "    npm:    https://www.npmjs.com/package/${PKG_NAME}"
echo "    github: https://github.com/${REPO_SLUG}/releases/tag/${TAG}"
