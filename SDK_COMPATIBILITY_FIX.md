# MCP SDK Compatibility Fix - Complete Root Cause Analysis

## TL;DR

**Two bugs** prevented Mentu from connecting to mcp4immich:
1. **SDK v1.30.0** had protocol negotiation bugs (fixed by upgrading to v1.32.1)
2. **Session ID reuse bug** in Mentu's era probe code (fixed by creating fresh transport for legacy fallback)

## Bug #1: Outdated SDK (PR #3/#4)

### Problem
`@mentu/metamcp@1.0.0` bundled `@modelcontextprotocol/sdk@1.30.0`, released July 27, 2026 — one day before Python SDK 2.2+ introduced "protocol eras". SDK v1.30.0 had edge cases in negotiating with dual-era servers.

### Solution  
Upgrade to SDK v1.32.1 (includes protocol negotiation fixes).

**Challenge**: Original Dockerfile used `npm install` which doesn't replace already-installed dependencies.

**Final fix**: Uninstall first, then install:
```dockerfile
npm uninstall @modelcontextprotocol/sdk &&
npm install @modelcontextprotocol/sdk@1.32.1
```

## Bug #2: Session ID Reuse (This PR)

### Problem

Even after SDK upgrade (PR #4), mcp4immich still failed with:
```
"POST /mcp HTTP/1.1" 400 Bad Request
Terminated session: <id>
"POST /mcp HTTP/1.1" 404 Not Found  
Error: Session not found
```

**Root Cause**: Mentu's era negotiation reuses the same transport between the modern probe and legacy fallback.

#### The Flow

1. **Probe Phase** (`probeChildEra`):
   - Sends `server/discover` to test for modern era (2026-07-28)
   - mcp4immich receives request, creates session, returns session ID in `mcp-session-id` header
   - `StreamableHTTPClientTransport` stores that session ID internally
   - Probe fails (mcp4immich doesn't support server/discover without valid session)
   - mcp4immich terminates the failed session

2. **Legacy Fallback** (`Client.connect`):
   - Code reuses the **same transport** from probe: `this.transport = framed`
   - Transport still has the stale session ID stored
   - Every request includes `mcp-session-id: <terminated-id>` header
   - mcp4immich rejects: "Session not found" (404)

#### Why Old Servers Work

Old servers (Hub, Portainer) don't use session IDs, so the stale ID is ignored. Only dual-era servers like mcp4immich enforce session validation.

### Solution

**Create fresh transport for legacy fallback** when probe fails with error:

```typescript
if (probe.reason && probe.reason.toLowerCase().includes('error')) {
    // Close probed transport (has stale session)
    await framed.close();
    
    // Create fresh transport (no session state)
    if (this.config.transport === 'http' && this.config.url) {
        this.transport = new StreamableHTTPClientTransport(
            new URL(this.config.url),
            { requestInit: { headers: this.config.headers ?? {} } }
        );
    }
} else {
    // MethodNotFound = clean legacy server, safe to reuse
    this.transport = framed;
}
```

Only recreate when `probe.reason` contains "error" — a clean `MethodNotFound` response means the server is legacy-only and the transport is safe to reuse.

## Implementation

### Files Changed

1. **metamcp/Dockerfile**
   - SDK upgrade (uninstall + install v1.32.1)
   - Apply session fix patch via script

2. **metamcp/patches/apply-session-fix.sh**
   - Patches `@mentu/metamcp/dist/mcp-client.js` at build time
   - Adds fresh transport creation for legacy fallback

3. **docker-compose.yml**
   - `pull_policy: build` to force rebuilds on Portainer redeploy

### Why Patch Instead of Upstream Fix?

- `@mentu/metamcp@1.0.0` is bundled/compiled JavaScript (dist/)
- Can't easily modify TypeScript source and rebuild
- Patch-at-build-time is safest for prod without waiting for upstream fix
- Upstream PR to https://github.com/mentu-ai/metamcp should follow

## Testing

### Verification Script

`test-mentu-inside-container.js` verifies:
1. ✅ SDK v1.32.1 is loaded
2. ✅ mcp4immich connection works (lists tools)
3. ✅ Old servers still work (Hub, Portainer)
4. ✅ Stdio servers still work (uvx)

```bash
docker cp test-mentu-inside-container.js mentu-metamcp:/test.js
docker exec -e MCP4IMMICH_URL=http://mcp4immich:8765/mcp mentu-metamcp node /test.js
```

### Expected Output

```
✅ PASS: SDK version 1.32.1 is loaded
✅ PASS: mcp4immich connection successful
  Found X tools
✅ PASS: Old server connection successful
```

## Deployment

### Rebuild Required

Must **force rebuild**, not just redeploy:

```bash
cd /path/to/stack
git pull
docker compose build --no-cache mentu-metamcp
docker compose up -d
```

### Verification Checklist

After deployment, verify:

1. **SDK version**: `docker exec mentu-metamcp node -p "require('@modelcontextprotocol/sdk/package.json').version"`
   - Must show: `1.32.1`

2. **Session fix applied**: `docker exec mentu-metamcp grep -q "recreating transport for legacy fallback" /usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js && echo "✓ Patch applied"`

3. **mcp4immich connects**: Check logs show tools listed, no 400/404 errors

4. **Old servers work**: Hub, Portainer still connect

## Technical Details

### mcp4immich Session Management

Python MCP SDK 2.2+ (`mcp/server/streamable_http_manager.py`):

- **Stateful mode** (default): Maintains sessions between requests
- Creates session ID on first request, returns in `mcp-session-id` header
- Subsequent requests must include valid session ID
- Returns 404 "Session not found" for unknown/expired IDs
- Terminates sessions that fail during establishment

### StreamableHTTPClientTransport Session Handling

TypeScript MCP SDK (`client/streamableHttp.js`):

```typescript
// Stores session ID from response
if (sessionId = response.headers.get('mcp-session-id')) {
    this._sessionId = sessionId;
}

// Includes session ID in all future requests
if (this._sessionId) {
    headers['mcp-session-id'] = this._sessionId;
}
```

Once a transport has a session ID, **every request** includes it. There's no way to clear it without creating a new transport.

## Backwards Compatibility

✅ **Fully backwards compatible**:
- Old servers (pre-2026 protocol): No session IDs, patch has no effect
- Stdio servers: No HTTP transport, patch skipped
- Clean legacy servers (MethodNotFound): Transport reused as before
- OAuth flows: Fresh transport creation preserves authProvider

## Related

- PR #3: Initial SDK upgrade attempt (incomplete)
- PR #4: Fixed SDK upgrade (uninstall first)
- This PR #5: Session ID reuse fix
- Upstream: https://github.com/mentu-ai/metamcp (should get both fixes)
