#!/usr/bin/env node
/**
 * Reproduce the mcp4immich connection issue
 * 
 * This script directly tests the MCP SDK client against a running mcp4immich server
 * to capture the exact request/response that causes the 400 error.
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP4IMMICH_URL = process.env.MCP4IMMICH_URL || 'http://localhost:8765/mcp';

console.log('='.repeat(70));
console.log('Reproducing mcp4immich Connection Issue');
console.log('='.repeat(70));
console.log(`Target: ${MCP4IMMICH_URL}`);
console.log('');

// Custom fetch to log all requests/responses
async function loggingFetch(url, init) {
  console.log('\n📤 REQUEST:');
  console.log(`  Method: ${init?.method || 'GET'}`);
  console.log(`  URL: ${url}`);
  console.log('  Headers:');
  const headers = init?.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    console.log(`    ${key}: ${value}`);
  }
  if (init?.body) {
    console.log('  Body:');
    console.log(`    ${init.body}`);
  }
  
  try {
    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type');
    
    console.log('\n📥 RESPONSE:');
    console.log(`  Status: ${response.status} ${response.statusText}`);
    console.log('  Headers:');
    response.headers.forEach((value, key) => {
      console.log(`    ${key}: ${value}`);
    });
    
    // Clone response so we can read body and still return it
    const cloned = response.clone();
    
    if (contentType?.includes('application/json')) {
      const body = await cloned.text();
      console.log('  Body:');
      try {
        const json = JSON.parse(body);
        console.log(`    ${JSON.stringify(json, null, 2)}`);
      } catch {
        console.log(`    ${body}`);
      }
    }
    
    return response;
  } catch (error) {
    console.error('\n❌ FETCH ERROR:', error.message);
    throw error;
  }
}

async function testConnection() {
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP4IMMICH_URL),
    { 
      requestInit: { headers: {} },
      fetch: loggingFetch
    }
  );
  
  let receivedMessages = [];
  
  transport.onmessage = (message) => {
    console.log('\n📨 Received message:', JSON.stringify(message, null, 2));
    receivedMessages.push(message);
  };
  
  transport.onerror = (error) => {
    console.error('\n❌ Transport error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  };
  
  try {
    console.log('\n1️⃣  Starting transport...');
    await transport.start();
    console.log('✓ Transport started');
    
    console.log('\n2️⃣  Sending initialize request...');
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mentu-test', version: '1.0.0' }
      }
    };
    
    await transport.send(initRequest);
    
    // Wait for response
    console.log('\n3️⃣  Waiting for response...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    if (receivedMessages.length > 0) {
      console.log('\n✅ Test completed - received response');
      return true;
    } else {
      console.log('\n❌ Test failed - no response received');
      return false;
    }
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    return false;
  } finally {
    try {
      await transport.close();
    } catch (e) {
      // Ignore close errors
    }
  }
}

testConnection().then(success => {
  process.exit(success ? 0 : 1);
});
