#!/bin/bash

# Publishing Script for Shiplight GitHub Action
# Run this after all changes are ready

set -e  # Exit on error

echo "🚀 Shiplight GitHub Action Publishing Script"
echo "==========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "action.yml" ]; then
  echo "❌ Error: action.yml not found. Are you in the github-action directory?"
  exit 1
fi

# Step 1: Build everything
echo "📦 Step 1: Building the action..."
npm run all

# Step 2: Check git status
echo ""
echo "📋 Step 2: Checking git status..."
git status

echo ""
echo "⚠️  Please review the changes above."
read -p "Do you want to continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted by user"
  exit 1
fi

# Step 3: Commit changes (if any)
echo ""
echo "💾 Step 3: Checking for uncommitted changes..."
if [[ -n $(git status --porcelain) ]]; then
  echo "Found uncommitted changes. Committing..."
  git add -A
  git commit -m "feat: improve authentication with better error handling

- Replace @zodash/doreamon with native fetch API
- Add retry logic with exponential backoff
- Improve error messages for authentication failures
- Add token validation
- Remove security issue (token logging)
- Better handling of rate limits and server errors"
else
  echo "✅ Working tree is clean, no changes to commit"
fi

# Step 4: Get version
echo ""
echo "🏷️  Step 4: Version Selection"
echo "Current tags:"
git tag | sort -V | tail -5
echo ""

# Get the latest version tag and suggest next patch version
LATEST_TAG=$(git tag | grep -E "^v[0-9]+\.[0-9]+\.[0-9]+$" | sort -V | tail -1)
if [[ -n $LATEST_TAG ]]; then
  # Extract version numbers
  VERSION_PARTS=(${LATEST_TAG//v/})
  VERSION_PARTS=(${VERSION_PARTS//./ })
  MAJOR=${VERSION_PARTS[0]}
  MINOR=${VERSION_PARTS[1]}
  PATCH=${VERSION_PARTS[2]}

  # Calculate next versions
  NEXT_PATCH=$((PATCH + 1))
  NEXT_MINOR=$((MINOR + 1))
  NEXT_MAJOR=$((MAJOR + 1))

  echo "Latest version: $LATEST_TAG"
  echo ""
  echo "Suggested versions:"
  echo "  Patch (bug fixes):       v${MAJOR}.${MINOR}.${NEXT_PATCH}"
  echo "  Minor (new features):    v${MAJOR}.${NEXT_MINOR}.0"
  echo "  Major (breaking changes): v${NEXT_MAJOR}.0.0"
  echo ""
  DEFAULT_VERSION="v${MAJOR}.${MINOR}.${NEXT_PATCH}"
  read -p "Enter new version (default: ${DEFAULT_VERSION}): " VERSION
  VERSION=${VERSION:-$DEFAULT_VERSION}
else
  echo "No version tags found"
  DEFAULT_VERSION="v1.0.0"
  read -p "Enter new version (default: ${DEFAULT_VERSION}): " VERSION
  VERSION=${VERSION:-$DEFAULT_VERSION}
fi

if [[ ! $VERSION =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Invalid version format. Use format like v1.2.6"
  exit 1
fi

# Extract major and minor versions
MAJOR_VERSION=$(echo $VERSION | grep -oE '^v[0-9]+')
MINOR_VERSION=$(echo $VERSION | grep -oE '^v[0-9]+\.[0-9]+')

echo ""
echo "📝 Version Summary:"
echo "  Full version: $VERSION"
echo "  Minor version: $MINOR_VERSION"
echo "  Major version: $MAJOR_VERSION"
echo ""
read -p "Is this correct? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted by user"
  exit 1
fi

# Step 5: Create and push tags
echo ""
echo "🏷️  Step 5: Creating tags..."

# Create specific version tag
git tag -a $VERSION -m "Release $VERSION: Improved authentication and error handling"

# Update major and minor version tags
git tag -fa $MAJOR_VERSION -m "Update $MAJOR_VERSION tag to $VERSION"
git tag -fa $MINOR_VERSION -m "Update $MINOR_VERSION tag to $VERSION"

# Step 6: Push everything
echo ""
echo "📤 Step 6: Pushing to GitHub..."
echo "This will push:"
echo "  - All commits to main branch"
echo "  - Tag $VERSION (new)"
echo "  - Tag $MINOR_VERSION (updated)"
echo "  - Tag $MAJOR_VERSION (updated)"
echo ""
read -p "Ready to push? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted by user"
  exit 1
fi

git push origin main
git push origin $VERSION
git push origin $MINOR_VERSION --force
git push origin $MAJOR_VERSION --force

# Step 7: Create GitHub release
echo ""
echo "🎉 Step 7: Creating GitHub Release"
echo ""
echo "Creating release notes..."

RELEASE_NOTES="## What's Changed

### 🚀 Improvements
- Replaced @zodash/doreamon dependency with native fetch API
- Improved authentication error messages for better debugging
- Added retry logic with exponential backoff for transient failures
- Enhanced token validation to catch configuration issues early
- Better handling of rate limits and server errors
- Improved debugging output with timestamps

### 🔒 Security
- Fixed security issue: removed plain text API token from logs
- API tokens now properly masked in all output

### 🐛 Bug Fixes
- Better error handling for malformed API responses
- More resilient polling during test execution
- Proper handling of network timeouts

## Breaking Changes
None - this is a backward compatible release

## Full Changelog
https://github.com/ShiplightAI/github-action/compare/v1.2.5...$VERSION"

echo "$RELEASE_NOTES" > release_notes.md

echo ""
echo "Release notes saved to release_notes.md"
echo ""
echo "Now create the release using GitHub CLI:"
echo ""
echo "gh release create $VERSION \\"
echo "  --title \"$VERSION: Improved Authentication and Error Handling\" \\"
echo "  --notes-file release_notes.md"
echo ""
echo "Or create it manually at:"
echo "https://github.com/ShiplightAI/github-action/releases/new?tag=$VERSION"
echo ""
echo "✅ Done! Don't forget to:"
echo "  1. Create the GitHub release"
echo "  2. Update the marketplace listing (happens automatically with release)"
echo "  3. Update README.md examples to show $VERSION"
echo "  4. Test the new version in a workflow"