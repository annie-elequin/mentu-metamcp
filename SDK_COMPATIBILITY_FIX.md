# MCP SDK Compatibility Fix

## Root Cause (UPDATED - Actual Issue Found)

The original fix in PR #3 did NOT work because of TWO problems:

### Problem 1: Incomplete SDK Upgrade in Dockerfile

The Dockerfile attempted to upgrade the SDK with:
```dockerfile
RUN cd /usr/local/lib/node_modules/@mentu/metamcp && \
    npm install @modelcontextprotocol/sdk@1.32.1 && \
    npm rebuild
```

This **fails** because `npm install` on an already-installed package **does not replace it** when it's declared as a dependency in package.json. Node's module resolution continues to use the old v1.30.0 bundled with `@mentu/metamcp@1.0.0`.

**Fix**: Must **uninstall first**, then install:
```dockerfile
RUN cd /usr/local/lib/node_modules/@mentu/metamcp && \
    npm uninstall @modelcontextprotocol/sdk && \
    npm install @modelcontextprotocol/sdk@1.32.1 && \
    npm rebuild && \
    node -p "require('@modelcontextprotocol/sdk/package.json').version"
```

### Problem 2: Portainer Git Redeploy Doesn't Rebuild Images

When using **"Pull and redeploy"** in Portainer on a Git-based stack with `build:` services, Portainer **does NOT rebuild** the images - it only restarts the existing containers.

Evidence: After PR #3 was merged and redeployed, the same error persisted. The Dockerfile change had no effect because the image was never rebuilt.

**Fix**: Add `pull_policy: build` to force rebuilds:
```yaml
services:
  mentu-metamcp:
    build:
      context: ./metamcp
    pull_policy: build  # Forces rebuild on redeploy
```

## The Original Problem (Still Valid)

`@mentu/metamcp@1.0.0` bundles `@modelcontextprotocol/sdk@1.30.0`, which has compatibility issues when connecting to HTTP MCP servers built with Python MCP SDK 2.2+ (e.g., mcp4immich).

Python SDK 2.2+ introduced "protocol eras":
- **Modern era (2026-07-28)**: Stateless protocol with `server/discover` handshake
- **Legacy era (pre-2026)**: Session-based protocol with `initialize` handshake

SDK v1.30.0 had edge cases in negotiating with dual-era servers, causing:
```
"POST /mcp HTTP/1.1" 400 Bad Request
Rejected request with unknown or expired session ID
"POST /mcp HTTP/1.1" 404 Not Found
```

Versions 1.30.1-1.32.1 fixed these negotiation bugs.

## The Fix

### Option 1: In-place SDK Upgrade (Current Approach)

Modified `metamcp/Dockerfile` to upgrade the bundled MCP SDK after installing `@mentu/metamcp@1.0.0`:

```dockerfile
RUN npm install -g @mentu/metamcp@1.0.0

# BUGFIX: Upgrade MCP SDK to fix compatibility with Python MCP SDK 2.2+
RUN cd /usr/local/lib/node_modules/@mentu/metamcp && \
    npm install @modelcontextprotocol/sdk@1.32.1 && \
    npm rebuild
```

This upgrades the SDK in-place while keeping the rest of `@mentu/metamcp@1.0.0` unchanged.

### Option 2: Upstream Fix (Recommended Long-term)

Submit a PR to https://github.com/mentu-ai/metamcp to:
1. Upgrade `package.json` dependency: `"@modelcontextprotocol/sdk": "^1.32.1"`
2. Run tests to verify compatibility
3. Publish as `@mentu/metamcp@1.0.1` or `@mentu/metamcp@1.1.0`

Then update `metamcp/Dockerfile` to use the new version.

## Testing

### Manual Test

1. Start mcp4immich server (or any Python MCP SDK 2.2+ server):
   ```bash
   export IMMICH_BASE_URL=http://your-immich IMMICH_API_KEY=your-key
   export MCP_TRANSPORT=streamable-http MCP_PORT=8765
   python -m mcp4immich
   ```

2. Configure Mentu to connect:
   ```json
   {
     "mcpServers": {
       "immich": {
         "url": "http://localhost:8765/mcp",
         "transportType": "http"
       }
     }
   }
   ```

3. Verify connection succeeds (no 400/404 errors in server logs)

### Regression Test

Ensure compatibility with BOTH old and new SDK servers:
- **Old-style servers**: FastMCP Python servers, Hono/TS official-SDK servers
- **New-style servers**: mcp4immich, any Python MCP SDK 2.2+ server
- **Stdio servers**: uvx-launched servers (e.g., portainer-mcp)

## Deployment

### Portainer Stack Rebuild (CRITICAL)

After merging this fix, a simple "Pull and redeploy" in Portainer **will not work** because it doesn't rebuild images.

#### Option 1: Force Rebuild via Portainer UI

1. In Portainer, navigate to the `mentu-metamcp` stack
2. Click **Editor**
3. Make any trivial change (add a comment, change a space) to force Portainer to detect changes
4. Click **Update the stack**
5. Enable **Re-pull images and redeploy**
6. Wait for the build to complete

#### Option 2: CLI Rebuild (Recommended)

SSH into the Portainer host and run:

```bash
cd /path/to/mentu-metamcp
git pull origin main
docker compose build --no-cache mentu-metamcp
docker compose up -d mentu-metamcp
```

#### Option 3: Delete and Recreate Stack

1. In Portainer, delete the `mentu-metamcp` stack
2. Recreate it from Git (same URL and settings)
3. Deploy

### Verification

After deployment, run the verification script inside the container:

```bash
# Copy the test script into the container
docker cp test-mentu-inside-container.js <container-name>:/test.js

# Run verification
docker exec <container-name> node /test.js

# Or test with mcp4immich
docker exec -e MCP4IMMICH_URL=http://mcp4immich:8765/mcp <container-name> node /test.js
```

Expected output:
```
STEP 1: Verifying SDK Version
✓ Found SDK at: /usr/local/lib/node_modules/@mentu/metamcp/node_modules/@modelcontextprotocol/sdk/package.json
  Version: 1.32.1

✅ PASS: SDK version 1.32.1 is loaded
```

If you see version 1.30.0, the image was NOT rebuilt properly.

## Backwards Compatibility

✅ **Safe**: SDK v1.32.1 maintains full backwards compatibility with:
- Pre-2026 protocol servers (legacy era)
- Existing client connections
- All stdio/SSE/HTTP transports

The upgrade only affects how the client negotiates with dual-era servers; it does not break existing connections.
