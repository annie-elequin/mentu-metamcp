const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = '/config/.mcp.json';
const BEARER_TOKEN = process.env.METAMCP_HTTP_BEARER_TOKEN;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Helper function to make HTTP requests with timeout
function makeRequest(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 5000
    };

    const req = transport.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    
    req.end();
  });
}

// Helper function to probe an MCP server for health and tools
async function probeMcpServer(serverName, serverConfig) {
  const result = {
    name: serverName,
    reachable: false,
    error: null,
    tools: [],
    transportType: serverConfig.transportType || 'http'
  };

  // Handle stdio servers - can't probe from UI
  if (serverConfig.command || serverConfig.transportType === 'stdio') {
    result.error = 'stdio transport - not probeable from UI';
    return result;
  }

  if (!serverConfig.url) {
    result.error = 'No URL configured';
    return result;
  }

  try {
    // Prepare headers with environment variable substitution
    const headers = {
      'Content-Type': 'application/json',
      ...serverConfig.headers
    };

    // Simple env var substitution (${VAR_NAME})
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string' && value.includes('${')) {
        const matches = value.match(/\$\{([^}]+)\}/g);
        if (matches) {
          let substituted = value;
          for (const match of matches) {
            const varName = match.slice(2, -1);
            const envValue = process.env[varName];
            if (envValue) {
              substituted = substituted.replace(match, envValue);
            }
          }
          headers[key] = substituted;
        }
      }
    }

    // Try to call the MCP tools/list endpoint
    // Note: This is a simplified probe - real MCP might use different handshake
    const toolsListPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    };

    const response = await makeRequest(
      serverConfig.url,
      {
        method: 'POST',
        headers: headers,
        timeout: 5000
      },
      toolsListPayload
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      result.reachable = true;
      
      // Parse tools from response
      if (response.data && response.data.result && response.data.result.tools) {
        result.tools = response.data.result.tools.map(tool => ({
          name: tool.name,
          description: tool.description || ''
        }));
      } else if (Array.isArray(response.data)) {
        // Some MCPs might return tools directly
        result.tools = response.data.map(tool => ({
          name: tool.name || tool,
          description: tool.description || ''
        }));
      }
    } else {
      result.error = `HTTP ${response.statusCode}`;
    }
  } catch (error) {
    result.error = error.message;
  }

  return result;
}

// Bearer token authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!BEARER_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: METAMCP_HTTP_BEARER_TOKEN not set' });
  }
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token required' });
  }
  
  const token = authHeader.substring(7);
  if (token !== BEARER_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  
  next();
};

// Health check (no auth)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Load config
app.get('/api/config', authenticate, async (req, res) => {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf8');
    res.json({ content });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Initialize empty config if it doesn't exist
      const defaultConfig = JSON.stringify({ mcpServers: {} }, null, 2);
      await fs.writeFile(CONFIG_PATH, defaultConfig, 'utf8');
      res.json({ content: defaultConfig });
    } else {
      res.status(500).json({ error: `Failed to read config: ${error.message}` });
    }
  }
});

// Save config
app.post('/api/config', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Validate JSON
    try {
      JSON.parse(content);
    } catch (e) {
      return res.status(400).json({ error: `Invalid JSON: ${e.message}` });
    }
    
    // Write config file
    await fs.writeFile(CONFIG_PATH, content, 'utf8');
    
    res.json({ 
      success: true, 
      message: 'Config saved successfully. MetaMCP will reload automatically.' 
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to save config: ${error.message}` });
  }
});

// Get server health status and tools
app.get('/api/servers/status', authenticate, async (req, res) => {
  try {
    // Read config
    let configContent;
    try {
      configContent = await fs.readFile(CONFIG_PATH, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.json({ servers: [] });
      }
      throw error;
    }

    const config = JSON.parse(configContent);
    const servers = config.mcpServers || {};

    // Probe all servers in parallel with individual timeouts
    const probePromises = Object.entries(servers).map(([name, serverConfig]) => 
      probeMcpServer(name, serverConfig)
    );

    const results = await Promise.all(probePromises);

    res.json({ servers: results });
  } catch (error) {
    res.status(500).json({ error: `Failed to get server status: ${error.message}` });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MetaMCP UI running on port ${PORT}`);
  console.log(`Config path: ${CONFIG_PATH}`);
  console.log(`Authentication: ${BEARER_TOKEN ? 'Enabled' : 'DISABLED - SET METAMCP_HTTP_BEARER_TOKEN'}`);
});
