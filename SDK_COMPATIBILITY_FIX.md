# MCP SDK Compatibility Fix

## Root Cause

The `@mentu/metamcp@1.0.0` package bundles `@modelcontextprotocol/sdk@1.30.0`, which has compatibility issues when connecting to HTTP MCP servers built with the newer Python MCP SDK 2.2+ (released mid-2026).

### The Problem

Python MCP SDK 2.2+ introduced "protocol eras":
- **Modern era (2026-07-28)**: Stateless protocol with `server/discover` handshake
- **Legacy era (pre-2026)**: Session-based protocol with `initialize` handshake

When Mentu tries to connect to servers like mcp4immich (built on Python SDK 2.2+), the connection sequence fails:

```
Created new transport with session ID: <id>
"POST /mcp HTTP/1.1" 400 Bad Request
Terminating session: <id>
Rejected request with unknown or expired session ID: <id>
"POST /mcp HTTP/1.1" 404 Not Found
```

### Why It Fails

The TypeScript SDK v1.30.0 was released (2026-07-27) right at the time of the protocol era change. Early versions had edge cases and bugs when negotiating protocol versions with dual-era servers.

The newer SDK versions (1.30.1, 1.31.0, 1.32.0, 1.32.1) include fixes for:
- Protocol version negotiation
- Header handling
- Session management compatibility
- Error recovery

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

### Portainer Stack Rebuild

After merging this fix:

1. In Portainer, navigate to the `mentu-metamcp` stack
2. Click **Pull and redeploy** or **Git pull & redeploy**
3. Wait for the build to complete (the Dockerfile change will be applied)
4. Verify the container restarts successfully
5. Test connection to mcp4immich

No config changes needed - bearer token and `.mcp.json` format unchanged.

## Backwards Compatibility

✅ **Safe**: SDK v1.32.1 maintains full backwards compatibility with:
- Pre-2026 protocol servers (legacy era)
- Existing client connections
- All stdio/SSE/HTTP transports

The upgrade only affects how the client negotiates with dual-era servers; it does not break existing connections.
