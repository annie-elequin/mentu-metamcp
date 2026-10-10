#!/bin/sh
# Apply session fix patch to @mentu/metamcp
# Fixes: Session ID reuse between era probe and legacy fallback causing "Session not found"

set -e

MCP_CLIENT=/usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js

if [ ! -f "$MCP_CLIENT" ]; then
    echo "ERROR: $MCP_CLIENT not found"
    exit 1
fi

echo "Applying session fix patch to mcp-client.js..."

# Create backup
cp "$MCP_CLIENT" "$MCP_CLIENT.backup"

# Apply the fix using Node.js for reliable text manipulation
cat > /tmp/apply-fix.js << 'JSEOF'
const fs = require('fs');
const file = '/usr/local/lib/node_modules/@mentu/metamcp/dist/mcp-client.js';
let code = fs.readFileSync(file, 'utf8');

// Target pattern (actual code structure from @mentu/metamcp@1.0.0)
const oldPattern = `        // Logged unconditionally: a clean MethodNotFound carries no \`reason\`, and
        // leaving that case silent made it impossible to tell "negotiated legacy"
        // apart from "never connected" when reading a live gateway's output.
        log('info', 'child using the legacy era', {
            server: this.config.name,
            ...(probe.reason ? { reason: probe.reason } : {}),
        });
        this.transport = framed;`;

// Fixed version with session reset logic
const newPattern = `        // BUGFIX: If probe failed with a transport error (not just MethodNotFound),
        // the transport may have a stale session ID from mcp4immich or other dual-era
        // servers. StreamableHTTPClientTransport stores session IDs from response headers.
        // When the probe fails, that session may be terminated on the server.
        // Create a FRESH transport for the legacy fallback to avoid "Session not found".
        if (probe.reason && probe.reason.toLowerCase().includes('error')) {
            log('info', 'recreating transport for legacy fallback', {
                server: this.config.name,
                reason: probe.reason
            });
            // Close the probed transport (may have stale session)
            try {
                await framed.close();
            }
            catch (e) {
                // Ignore close errors
            }
            // Create fresh transport (same config, no stale session)
            if (this.config.transport === 'http' && this.config.url) {
                this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
                    requestInit: { headers: this.config.headers ?? {} }
                });
            }
            else if (this.config.transport === 'sse' && this.config.url) {
                this.transport = new SSEClientTransport(new URL(this.config.url), {
                    requestInit: { headers: this.config.headers ?? {} }
                });
            }
            else {
                // stdio doesn't have session state
                this.transport = framed;
            }
        }
        else {
            // Probe succeeded with MethodNotFound or no error - safe to reuse
            this.transport = framed;
        }
        log('info', 'child using the legacy era', {
            server: this.config.name,
            ...(probe.reason ? { reason: probe.reason } : {}),
        });`;

if (code.includes(oldPattern)) {
    code = code.replace(oldPattern, newPattern);
    fs.writeFileSync(file, code, 'utf8');
    console.log('✓ Session fix patch applied successfully');
    console.log('✓ Target: mcp-client.js legacy era session handling');
    process.exit(0);
} else {
    console.error('');
    console.error('✗ PATCH FAILED: Target pattern not found in mcp-client.js');
    console.error('');
    console.error('This means @mentu/metamcp code has changed since the patch was written.');
    console.error('Expected pattern (lines 108-115):');
    console.error('');
    console.error('        // Logged unconditionally: a clean MethodNotFound...');
    console.error("        log('info', 'child using the legacy era', {");
    console.error('            server: this.config.name,');
    console.error('            ...(probe.reason ? { reason: probe.reason } : {}),');
    console.error('        });');
    console.error('        this.transport = framed;');
    console.error('');
    console.error('Actual code around "child using the legacy era":');
    console.error('');
    
    // Show what we actually found
    const lines = code.split('\n');
    const targetLine = lines.findIndex(l => l.includes('child using the legacy era'));
    if (targetLine >= 0) {
        const start = Math.max(0, targetLine - 5);
        const end = Math.min(lines.length, targetLine + 10);
        for (let i = start; i < end; i++) {
            console.error(`${(i+1).toString().padStart(4)}: ${lines[i]}`);
        }
    } else {
        console.error('(string "child using the legacy era" not found at all!)');
    }
    console.error('');
    console.error('Build failed intentionally to prevent deploying unpatched code.');
    process.exit(1);
}
JSEOF

node /tmp/apply-fix.js

# Verify the patch was applied
if grep -q "recreating transport for legacy fallback" "$MCP_CLIENT"; then
    echo "✓ Verification passed: patch code found in mcp-client.js"
else
    echo "✗ Verification failed: patch code NOT found in mcp-client.js"
    exit 1
fi

echo "Session fix patch complete"
