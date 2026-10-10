#!/bin/sh
# Apply session fix patch to @mentu/metamcp

set -e

MCP_CLIENT=/usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js

echo "Applying session fix patch to mcp-client.js..."

# Create backup
cp "$MCP_CLIENT" "$MCP_CLIENT.backup"

# Apply the fix using sed
# Find the line with "this.transport = framed;" after the legacy era log
# and replace the section with the fixed version

cat > /tmp/mcp-client-fix.sed << 'SEDEOF'
/child using the legacy era/ {
    # Read the next few lines into pattern space
    N
    N
    N
    N
    # Check if we're at the problematic section
    /this\.transport = framed;/ {
        # Replace the whole section
        s/.*/    \/\/ BUGFIX: If probe failed with a transport error (not just MethodNotFound),\
    \/\/ the transport may have a stale session ID from mcp4immich or other dual-era\
    \/\/ servers. Create a FRESH transport for the legacy fallback.\
    if (probe.reason \&\& probe.reason.toLowerCase().includes('error')) {\
        log('info', 'recreating transport for legacy fallback', { server: this.config.name });\
        try { await framed.close(); } catch (e) { \/\/ Ignore \
        }\
        if (this.config.transport === 'http' \&\& this.config.url) {\
            this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers ?? {} } });\
        } else if (this.config.transport === 'sse' \&\& this.config.url) {\
            this.transport = new SSEClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers ?? {} } });\
        }\
    } else {\
        this.transport = framed;\
    }\
    log('info', 'child using the legacy era', {\
        server: this.config.name,\
        ...(probe.reason ? { reason: probe.reason } : {}),\
    });/
    }
}
SEDEOF

# Actually, sed is too complex for this. Let's use a simpler approach with Node.js
cat > /tmp/apply-fix.js << 'JSEOF'
const fs = require('fs');
const file = '/usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js';
let code = fs.readFileSync(file, 'utf8');

// Find and replace the problematic section
const oldPattern = `    log('info', 'child using the legacy era', {
        server: this.config.name,
        ...(probe.reason ? { reason: probe.reason } : {}),
    });
    this.transport = framed;`;

const newPattern = `    // BUGFIX: If probe failed with error, transport may have stale session ID.
    // Create fresh transport for legacy fallback to avoid "Session not found".
    if (probe.reason && probe.reason.toLowerCase().includes('error')) {
        log('info', 'recreating transport for legacy fallback', { server: this.config.name });
        try { await framed.close(); } catch (e) { /* ignore */ }
        if (this.config.transport === 'http' && this.config.url) {
            this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers ?? {} } });
        } else if (this.config.transport === 'sse' && this.config.url) {
            this.transport = new SSEClientTransport(new URL(this.config.url), { requestInit: { headers: this.config.headers ?? {} } });
        }
    } else {
        this.transport = framed;
    }
    log('info', 'child using the legacy era', {
        server: this.config.name,
        ...(probe.reason ? { reason: probe.reason } : {}),
    });`;

if (code.includes(oldPattern)) {
    code = code.replace(oldPattern, newPattern);
    fs.writeFileSync(file, code, 'utf8');
    console.log('✓ Patch applied successfully');
    process.exit(0);
} else {
    console.error('✗ Pattern not found - code may have changed');
    process.exit(1);
}
JSEOF

node /tmp/apply-fix.js

echo "Session fix applied successfully"
