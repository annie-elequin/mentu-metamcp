#!/usr/bin/env node
/**
 * Verify which SDK version is actually loaded at runtime
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Try to find the SDK package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function findSDKVersion() {
  console.log('Looking for MCP SDK version...\n');
  
  try {
    // Method 1: Import and check if there's a version export
    const sdk = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    console.log('✓ SDK module loaded successfully');
    
    // Method 2: Find package.json
    const paths = [
      // Global install
      '/usr/local/lib/node_modules/@modelcontextprotocol/sdk/package.json',
      // Local node_modules
      join(process.cwd(), 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
      // Parent node_modules (for nested installs)
      join(__dirname, '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
      join(__dirname, '..', '..', 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
    ];
    
    let foundVersion = null;
    for (const path of paths) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf8'));
        console.log(`\n📦 Found SDK at: ${path}`);
        console.log(`   Version: ${pkg.version}`);
        foundVersion = pkg.version;
        break;
      } catch (e) {
        // Try next path
      }
    }
    
    if (!foundVersion) {
      console.log('\n⚠️  Could not find SDK package.json in standard locations');
    }
    
    // Method 3: Check what metamcp's node_modules has
    const mentuPaths = [
      '/usr/local/lib/node_modules/@mentu/metamcp/node_modules/@modelcontextprotocol/sdk/package.json',
    ];
    
    for (const path of mentuPaths) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf8'));
        console.log(`\n📦 Found SDK in metamcp's node_modules: ${path}`);
        console.log(`   Version: ${pkg.version}`);
      } catch (e) {
        console.log(`\n   Not found: ${path}`);
      }
    }
    
    return foundVersion;
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    return null;
  }
}

findSDKVersion().then(version => {
  if (version) {
    console.log(`\n✅ SDK version: ${version}`);
    if (version === '1.32.1') {
      console.log('✓ Correct version (1.32.1) is loaded');
      process.exit(0);
    } else {
      console.log(`⚠️  Expected 1.32.1 but found ${version}`);
      process.exit(1);
    }
  } else {
    console.log('\n❌ Could not determine SDK version');
    process.exit(1);
  }
});
