#!/usr/bin/env node
/**
 * Regression test for MCP SDK compatibility
 * 
 * Tests that Mentu can connect to both:
 * 1. Old-style MCP servers (pre-2026 protocol, session-based)
 * 2. New-style MCP servers (2026-07-28 protocol, stateless)
 * 
 * Usage:
 *   node test-mcp-compatibility.js <old-server-url> <new-server-url>
 * 
 * Example:
 *   node test-mcp-compatibility.js \
 *     http://localhost:8001/mcp \
 *     http://localhost:8765/mcp
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const [,, oldServerUrl, newServerUrl] = process.argv;

if (!oldServerUrl || !newServerUrl) {
  console.error('Usage: node test-mcp-compatibility.js <old-server-url> <new-server-url>');
  console.error('Example: node test-mcp-compatibility.js http://localhost:8001/mcp http://localhost:8765/mcp');
  process.exit(1);
}

async function testServer(url, description) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${description}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(60));
  
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
    console.log('✓ Connected successfully');
    
    console.log('→ Listing tools...');
    const result = await client.listTools();
    console.log(`✓ Found ${result.tools.length} tools`);
    
    if (result.tools.length > 0) {
      console.log(`  First tool: ${result.tools[0].name}`);
    }
    
    console.log('→ Closing connection...');
    await client.close();
    console.log('✓ Closed successfully');
    
    console.log(`\n✅ ${description} PASSED`);
    return true;
  } catch (error) {
    console.error(`\n❌ ${description} FAILED`);
    console.error(`   Error: ${error.message}`);
    
    // Show more details for debugging
    if (error.cause) {
      console.error(`   Cause: ${error.cause}`);
    }
    if (error.stack) {
      console.error(`\n   Stack trace:\n${error.stack.split('\n').slice(0, 5).join('\n')}`);
    }
    
    try {
      await client.close();
    } catch (closeError) {
      // Ignore close errors after failure
    }
    
    return false;
  }
}

async function main() {
  console.log('MCP SDK Compatibility Regression Test');
  console.log('======================================\n');
  console.log('This test verifies that Mentu can connect to both:');
  console.log('1. Old-style servers (pre-2026 protocol, session-based)');
  console.log('2. New-style servers (2026-07-28 protocol, stateless)');
  
  const results = {
    old: false,
    new: false
  };
  
  // Test old-style server
  results.old = await testServer(oldServerUrl, 'Old-style MCP server');
  
  // Wait a bit between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test new-style server
  results.new = await testServer(newServerUrl, 'New-style MCP server (Python SDK 2.2+)');
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Old-style server: ${results.old ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`New-style server: ${results.new ? '✅ PASS' : '❌ FAIL'}`);
  
  const allPassed = results.old && results.new;
  console.log('\n' + (allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'));
  
  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
