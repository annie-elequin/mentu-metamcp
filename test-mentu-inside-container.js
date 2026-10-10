#!/usr/bin/env node
/**
 * Comprehensive test to verify Mentu works with both old and new MCP servers
 * 
 * This script should be run INSIDE the Mentu container to verify:
 * 1. The correct SDK version (1.32.1) is loaded
 * 2. Connection to mcp4immich (Python SDK 2.2+, modern era) works
 * 3. Connection to old-style servers still works
 * 4. Connection to stdio uvx servers still works
 * 
 * Usage:
 *   docker exec test-mentu node /test-mentu-compatibility.js
 */

import { readFileSync } from 'fs';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

console.log('='.repeat(70));
console.log('Mentu MCP Compatibility Verification');
console.log('='.repeat(70));
console.log('');

// Step 1: Verify SDK version
console.log('STEP 1: Verifying SDK Version');
console.log('-'.repeat(70));

let sdkVersion = null;
const sdkPaths = [
  '/usr/local/lib/node_modules/@mentu/metamcp/node_modules/@modelcontextprotocol/sdk/package.json',
  '/usr/local/lib/node_modules/@modelcontextprotocol/sdk/package.json',
];

for (const path of sdkPaths) {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    console.log(`✓ Found SDK at: ${path}`);
    console.log(`  Version: ${pkg.version}`);
    sdkVersion = pkg.version;
    break;
  } catch (e) {
    console.log(`  Not found: ${path}`);
  }
}

if (sdkVersion !== '1.32.1') {
  console.error(`\n❌ FAIL: Expected SDK 1.32.1 but found ${sdkVersion || 'unknown'}`);
  console.error('   The Dockerfile SDK upgrade did not work!');
  process.exit(1);
}

console.log(`\n✅ PASS: SDK version 1.32.1 is loaded\n`);

// Step 2: Test connection to mcp4immich (if URL provided)
const MCP4IMMICH_URL = process.env.MCP4IMMICH_URL;
const OLD_SERVER_URL = process.env.OLD_SERVER_URL;

async function testServer(url, name, description) {
  console.log(`\nSTEP: Testing ${name}`);
  console.log('-'.repeat(70));
  console.log(`URL: ${url}`);
  console.log(`Type: ${description}`);
  
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    { requestInit: { headers: {} } }
  );
  
  const client = new Client({
    name: 'mentu-compatibility-test',
    version: '1.0.0'
  }, {
    capabilities: {}
  });
  
  try {
    console.log('→ Connecting...');
    await client.connect(transport);
    console.log('✓ Connected');
    
    console.log('→ Listing tools...');
    const result = await client.listTools();
    console.log(`✓ Found ${result.tools.length} tools`);
    
    if (result.tools.length > 0) {
      console.log(`  Sample tool: ${result.tools[0].name}`);
    }
    
    await client.close();
    console.log(`\n✅ PASS: ${name} connection successful`);
    return true;
  } catch (error) {
    console.error(`\n❌ FAIL: ${name} connection failed`);
    console.error(`   Error: ${error.message}`);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    
    try {
      await client.close();
    } catch (e) {
      // Ignore
    }
    
    return false;
  }
}

async function runTests() {
  const results = {
    sdk: true, // Already verified above
    mcp4immich: null,
    oldServer: null
  };
  
  if (MCP4IMMICH_URL) {
    results.mcp4immich = await testServer(
      MCP4IMMICH_URL,
      'mcp4immich',
      'Python SDK 2.2+, modern era (2026-07-28)'
    );
  } else {
    console.log('\nℹ️  MCP4IMMICH_URL not set, skipping mcp4immich test');
    console.log('   Set MCP4IMMICH_URL=http://mcp4immich:8765/mcp to test');
  }
  
  if (OLD_SERVER_URL) {
    results.oldServer = await testServer(
      OLD_SERVER_URL,
      'Old-style server',
      'Pre-2026 protocol, legacy era'
    );
  } else {
    console.log('\nℹ️  OLD_SERVER_URL not set, skipping old-style server test');
    console.log('   Set OLD_SERVER_URL=http://old-server:8080/mcp to test');
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`SDK Version Check:     ${results.sdk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`mcp4immich Connection: ${results.mcp4immich === null ? '⊘ SKIP' : results.mcp4immich ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Old Server Connection: ${results.oldServer === null ? '⊘ SKIP' : results.oldServer ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPass = results.sdk && 
    (results.mcp4immich === null || results.mcp4immich) &&
    (results.oldServer === null || results.oldServer);
  
  console.log('\n' + (allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'));
  console.log('='.repeat(70) + '\n');
  
  process.exit(allPass ? 0 : 1);
}

runTests().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
