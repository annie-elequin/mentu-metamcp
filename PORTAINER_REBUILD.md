# Portainer Rebuild Fix

## Problem

Portainer's **"Pull and redeploy"** action does NOT rebuild images for `build:` services when:
- The image name/tag hasn't changed
- Docker Compose sees "no changes" to trigger rebuild
- Even with `pull_policy: build`

**Result**: After PR #3, #4, and #5 were merged, Portainer redeployed but never rebuilt the images. Containers kept running old code.

## Root Cause

Docker Compose decides whether to rebuild by checking:
1. Dockerfile modification time (not git commit time!)
2. Build context file changes
3. Build arg values

When you `git pull` a new commit:
- Dockerfile mtime is updated to checkout time
- BUT Docker's cached layer sees same content = skip rebuild
- Compose sees same image tag = reuses old image
- Container not recreated

Portainer's StackGitRedeploy calls `docker-compose pull` then `docker-compose up -d`:
- `pull` does nothing for `build:` services with no `image:` tag
- `up -d` sees no changes, skips rebuild

## Solution

### 1. Dynamic Image Tags

Add `BUILD_VERSION` arg that changes with each meaningful commit:

```yaml
services:
  mentu-metamcp:
    build:
      context: ./metamcp
      args:
        BUILD_VERSION: ${BUILD_VERSION:-dev}
    image: mentu-metamcp:${BUILD_VERSION:-dev}  # Tag includes version
```

- Image tag changes = Docker sees new image = force rebuild
- Container recreated even if code unchanged

### 2. Build Version File

`.buildversion` file tracks current version (integer):
```
6
```

Increment it before meaningful commits:
```bash
./bump-version.sh
git add .buildversion
git commit -m "Bump build version to 7"
git push
```

### 3. Dockerfile Labels

Dockerfiles now have:
```dockerfile
ARG BUILD_VERSION=dev
LABEL build.version="${BUILD_VERSION}"
```

Labels embedded in image = forces new image ID even with same layers.

## How to Use

### For Developers (Before Commit)

When making changes that MUST trigger rebuild (bugfixes, patches):

```bash
# 1. Make your changes
vim metamcp/Dockerfile

# 2. Bump version
./bump-version.sh
# Output: Updated .buildversion: 6 → 7

# 3. Commit everything
git add -A
git commit -m "Fix session bug

Bumps build version to 7 to force Portainer rebuild"
git push
```

### For Portainer Deployment

#### Option A: Auto-Rebuild (Recommended)

Set environment variable in Portainer stack:
```bash
BUILD_VERSION=7  # Match .buildversion content
```

Then use normal **"Pull and redeploy"**:
- Portainer pulls git repo
- Sees BUILD_VERSION=7
- Image tag becomes `mentu-metamcp:7`
- Forces rebuild + recreation

#### Option B: Manual Rebuild

If auto-rebuild still doesn't work:

```bash
# SSH to Portainer host
cd /path/to/stack

# Pull latest
git pull

# Set version from file
export BUILD_VERSION=$(cat .buildversion)

# Force rebuild
docker compose build --no-cache mentu-metamcp mentu-metamcp-ui

# Recreate containers
docker compose up -d --force-recreate
```

## Verification

### After Portainer Redeploy

Check that container was actually recreated:

```bash
# 1. Check container start time (should be recent)
docker inspect mentu-metamcp --format='{{.State.StartedAt}}'
# Should show: 2026-10-10T00:4X:XXZ (recent timestamp)

# 2. Check image tag
docker inspect mentu-metamcp --format='{{.Config.Image}}'
# Should show: mentu-metamcp:7 (current version)

# 3. Check build version label
docker inspect mentu-metamcp --format='{{index .Config.Labels "build.version"}}'
# Should show: 7

# 4. Verify patch applied
docker exec mentu-metamcp grep -c "recreating transport" \
  /usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js
# Should show: 1 (patch is present)
```

### Check Logs

```bash
docker logs mentu-metamcp --since 5m | grep "recreating transport"
```

Should see:
```json
{"level":"info","msg":"recreating transport for legacy fallback","server":"immich"}
```

## Workflow After This PR

### Future Code Changes

1. Make changes to Dockerfile/code
2. Run `./bump-version.sh`
3. Commit: `git add .buildversion && git commit ...`
4. Push
5. In Portainer: Update BUILD_VERSION env var to match
6. Click "Pull and redeploy"
7. Verify container recreated with new timestamp

### Portainer Environment Variables

Add to stack environment:
```
BUILD_VERSION=7
METAMCP_HTTP_BEARER_TOKEN=your-token
```

Update BUILD_VERSION whenever you want to force rebuild.

## Alternative: Auto-Version from Git

For fully automatic versioning (no manual bump):

```yaml
# .env file (not in git)
BUILD_VERSION=$(git rev-parse --short HEAD)
```

But this requires .env or env_file in compose, which Portainer doesn't support well. Manual version file is more reliable.

## Why Not Just Force Rebuild Always?

Could do:
```bash
docker compose up -d --build --force-recreate
```

But:
- Rebuilds even when unnecessary (slow)
- Portainer's UI doesn't support these flags
- Selective rebuild is more efficient

## Summary

**Before**: Portainer redeploy didn't rebuild, containers kept running old code

**After**: 
- Image tag changes force rebuild
- .buildversion tracks when rebuild needed
- Portainer redeploy actually rebuilds

**Next Steps**:
1. Merge this PR
2. Set `BUILD_VERSION=6` in Portainer stack env
3. Pull and redeploy
4. Verify container timestamp updated
5. For future changes: bump version, commit, redeploy
