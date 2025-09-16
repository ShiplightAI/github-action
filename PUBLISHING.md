# Publishing the Shiplight GitHub Action

## Prerequisites

- Ensure all changes are committed
- Ensure `dist/index.js` is up to date
- Decide on version number (follow semantic versioning)

## Step 1: Prepare the Code

### 1.1 Build the Action

```bash
npm run all
# This runs: format, lint, test, coverage, and package
```

### 1.2 Commit the dist folder

```bash
git add dist/
git commit -m "build: Update dist for release"
```

## Step 2: Version and Tag

### 2.1 Update version in package.json (optional)

```bash
npm version patch  # for bug fixes (1.2.5 -> 1.2.6)
npm version minor  # for new features (1.2.5 -> 1.3.0)
npm version major  # for breaking changes (1.2.5 -> 2.0.0)
```

### 2.2 Create and push tags

```bash
# Create a specific version tag
git tag -a v1.2.6 -m "Release v1.2.6: Improved authentication and error handling"
git push origin v1.2.6

# Also update/create major and minor version tags for users
git tag -fa v1 -m "Update v1 tag to v1.2.6"
git push origin v1 --force

git tag -fa v1.2 -m "Update v1.2 tag to v1.2.6"
git push origin v1.2 --force
```

## Step 3: Create GitHub Release

### 3.1 Via GitHub CLI

```bash
gh release create v1.2.6 \
  --title "v1.2.6: Improved Authentication" \
  --notes "## What's Changed
- Replaced @zodash/doreamon with native fetch API
- Improved authentication error messages
- Added retry logic with exponential backoff
- Enhanced token validation
- Better handling of rate limits and server errors
- Security: Removed plain text API token logging

## Breaking Changes
None

## Full Changelog
https://github.com/ShiplightAI/github-action/compare/v1.2.5...v1.2.6"
```

### 3.2 Via GitHub Web Interface

1. Go to https://github.com/ShiplightAI/github-action/releases
2. Click "Draft a new release"
3. Choose tag: `v1.2.6`
4. Release title: `v1.2.6: Improved Authentication`
5. Add release notes (see above)
6. Check "Set as the latest release"
7. Click "Publish release"

## Step 4: Publish to GitHub Marketplace

### 4.1 First-time Publishing

1. Go to https://github.com/ShiplightAI/github-action
2. Click "Marketplace" tab or go to Settings > Actions > General
3. Click "Draft a release" under Marketplace
4. Review the action.yml metadata:
   - Name must be unique
   - Description should be clear
   - Branding icon and color are set
5. Select categories (e.g., "Testing", "Continuous Integration")
6. Accept the GitHub Marketplace Developer Agreement
7. Choose pricing (typically free)
8. Publish

### 4.2 Updating Existing Marketplace Listing

When you create a new release with proper semantic versioning, it automatically
updates the Marketplace listing.

## Step 5: Update Documentation

### 5.1 Update README.md

Update the usage examples to show the new version:

```yaml
- uses: ShiplightAI/github-action@v1.2.6
  with:
    api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
    test-suite-id: 1,2,3
    environment-id: 1
```

### 5.2 Update CHANGELOG.md (if exists)

Document what changed in this version.

## Step 6: Notify Users (Optional)

For significant updates, consider:

1. Creating a GitHub Discussion
2. Posting in relevant channels
3. Updating any external documentation

## Version Tag Strategy

We recommend maintaining three tag levels:

- **Specific version**: `v1.2.6` (immutable)
- **Minor version**: `v1.2` (points to latest patch)
- **Major version**: `v1` (points to latest minor)

This allows users to:

- Pin to exact version: `uses: ShiplightAI/github-action@v1.2.6`
- Get patch updates: `uses: ShiplightAI/github-action@v1.2`
- Get all non-breaking updates: `uses: ShiplightAI/github-action@v1`

## Testing Before Release

Test the action locally:

```bash
# Create a test workflow file
cat > .github/workflows/test-action.yml << 'EOF'
name: Test Action
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: ./
        with:
          api-token: ${{ secrets.SHIPLIGHT_API_TOKEN }}
          test-suite-id: 1
          environment-id: 1
EOF

# Run with act (requires Docker)
act -s SHIPLIGHT_API_TOKEN=your-test-token
```

## Rollback Procedure

If issues are discovered after release:

1. Delete the problematic release (keep the tag)
2. Fix the issue
3. Rebuild: `npm run all`
4. Commit fixes and dist/
5. Create new patch version
6. Update tags and create new release

## Security Considerations

- Never commit sensitive data
- Ensure dist/ is built from clean source
- Review dependencies for vulnerabilities: `npm audit`
- Token validation is in place
- API tokens are masked in logs

## Monitoring

After publishing:

1. Check GitHub Actions tab for any failed workflows
2. Monitor issues for user reports
3. Check Marketplace metrics (views, stars, usage)
