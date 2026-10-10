# Portainer Rebuild Fix

## Problem

Portainer's **"Pull and redeploy"** action does NOT rebuild images for `build:` services when the image name/tag hasn't changed, even with `pull_policy: build`.

**Result**: After PR #3, #4, and #5 were merged, Portainer redeployed but never rebuilt the images. Containers kept running old code.

## Root Cause

Docker Compose decides whether to rebuild by checking:
1. Image name/tag
2. Build context file changes
3. Build arg values

When you `git pull` a new commit:
- Dockerfile content changes
- BUT if image tag unchanged → Docker sees "same image" → skips rebuild
- Compose sees same image tag → reuses old image
- Container not recreated

Portainer's StackGitRedeploy:
- Calls `docker-compose pull` (does nothing for `build:` services)
- Then `docker-compose up -d` (sees no changes, skips rebuild)

## Solution

**Hardcode incrementing image tags in docker-compose.yml:**

```yaml
services:
  mentu-metamcp:
    build:
      context: ./metamcp
      args:
        BUILD_VERSION: "7"  # Hardcoded version
    image: mentu-metamcp:7  # Hardcoded tag
```

When you change code and bump the tag:
- Image tag changes from `:6` to `:7`
- Docker Compose sees new image → forces rebuild
- Container recreated with fresh build

**No Portainer environment variable changes needed** - version lives entirely in the repo.

## Changes

**docker-compose.yml**:
- Hardcoded `image: mentu-metamcp:7` and `mentu-metamcp-ui:7`
- Hardcoded `BUILD_VERSION: "7"` build arg
- Tag increments with each rebuild-worthy change

**Dockerfiles** (metamcp + ui):
- Accept `BUILD_VERSION` arg (defaults to "dev")
- Add build version label

**.buildversion**:
- Version 7 (current - includes session fix)
- Tracks current version for reference

**bump-version.sh**:
- Helper to update version in docker-compose.yml AND .buildversion
- Automatically edits the hardcoded tags

## Usage

### Making Changes That Need Rebuild

When editing Dockerfile, patches, or other build-time code:

```bash
# 1. Make your changes
vim metamcp/patches/apply-session-fix.sh

# 2. Bump version (updates docker-compose.yml and .buildversion)
./bump-version.sh
# Output: 
#   Updated docker-compose.yml: version 7 → 8
#   Updated .buildversion: 7 → 8

# 3. Verify changes
git diff docker-compose.yml  # Check image tags changed to :8

# 4. Commit
git add -A
git commit -m "Fix XYZ bug

Bumps build version to 8 for Portainer rebuild"
git push
```

### Deploying via Portainer

After pushing changes:

1. **In Portainer**: Click **"Pull and redeploy"**
2. **That's it!** No environment variable changes needed

Portainer will:
- Pull git repo (gets new `docker-compose.yml` with `:8` tags)
- See image tag changed from `:7` to `:8`
- Build new images
- Recreate containers

### Verification After Deploy

```bash
# 1. Check container start time (should be recent)
docker inspect mentu-metamcp --format='{{.State.StartedAt}}'

# 2. Check image tag matches current version
docker inspect mentu-metamcp --format='{{.Config.Image}}'
# Expected: mentu-metamcp:7 (or current version)

# 3. Check build version label
docker inspect mentu-metamcp --format='{{index .Config.Labels "build.version"}}'
# Expected: 7 (matches tag)

# 4. Verify code changes applied
docker exec mentu-metamcp grep -c "recreating transport" \
  /usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js
# Expected: 1 (patch present)
```

## How bump-version.sh Works

The script:
1. Reads current version from `.buildversion`
2. Increments it
3. **Updates docker-compose.yml** hardcoded tags:
   - `image: mentu-metamcp:7` → `image: mentu-metamcp:8`
   - `BUILD_VERSION: "7"` → `BUILD_VERSION: "8"`
   - Same for UI service
4. Updates `.buildversion` file
5. Shows you what changed

## Manual Version Bump

If you prefer to edit manually:

1. Edit `docker-compose.yml`:
   ```yaml
   # Change BOTH services:
   mentu-metamcp:
     build:
       args:
         BUILD_VERSION: "8"  # Increment
     image: mentu-metamcp:8  # Increment
   
   mentu-metamcp-ui:
     build:
       args:
         BUILD_VERSION: "8"  # Increment
     image: mentu-metamcp-ui:8  # Increment
   ```

2. Update `.buildversion`:
   ```bash
   echo "8" > .buildversion
   ```

3. Commit and push

## Why This Works

### Before (PRs #3-5)

```
git pull → Dockerfile changes BUT no image: tag in compose
        → Docker auto-generates same tag from service name
        → Docker: "same image, skip rebuild"
        → Portainer: restarts old container
        → Code never updated
```

### After (This PR)

```
git pull → docker-compose.yml has image: mentu-metamcp:8
        → Portainer sees tag changed from :7 to :8
        → Docker: "new tag, must rebuild"
        → Builds mentu-metamcp:8
        → Creates container from :8
        → Code updated!
```

## Workflow Summary

1. **Make code changes**
2. **Run `./bump-version.sh`** (increments version in compose + .buildversion)
3. **Commit and push**
4. **In Portainer: "Pull and redeploy"**
5. **Done** - container rebuilds automatically

No environment variable management. No manual edits to Portainer stack settings. Version lives entirely in git.

## Alternative: Force Rebuild Manually

If Portainer still doesn't rebuild (shouldn't happen with explicit tags):

```bash
# SSH to Portainer host
cd /path/to/stack
git pull
docker compose build --no-cache mentu-metamcp mentu-metamcp-ui
docker compose up -d --force-recreate
```

## What Happens After This PR

Once merged:

1. **First deploy**: Portainer pulls repo with `:7` tags, builds, recreates
2. **Verification**: All fixes from PRs #3-5 finally applied
3. **Future changes**: Bump version, push, redeploy - automatic rebuilds
4. **No more stale containers**: Tag changes force rebuilds every time
