const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = '/config/.mcp.json';
const BEARER_TOKEN = process.env.METAMCP_HTTP_BEARER_TOKEN;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MetaMCP UI running on port ${PORT}`);
  console.log(`Config path: ${CONFIG_PATH}`);
  console.log(`Authentication: ${BEARER_TOKEN ? 'Enabled' : 'DISABLED - SET METAMCP_HTTP_BEARER_TOKEN'}`);
});
