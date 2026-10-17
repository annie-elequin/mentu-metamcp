const express = require('express');
const fs = require('fs').promises;
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.CONFIG_PATH || '/config/.mcp.json';
const BEARER_TOKEN = process.env.METAMCP_HTTP_BEARER_TOKEN;
// Same rule as @mentu/metamcp (dist/types.js): gateway rejects the whole config if any name fails.
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const INVALID_NAME_HINT = 'use letters, digits, ".", "_", or "-" (1–128 chars, must start with a letter or digit)';

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

function substituteEnv(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = typeof value === 'string'
      ? value.replace(/\$\{([^}]+)\}/g, (match, name) => process.env[name] ?? match)
      : value;
  }
  return out;
}

function formatProbeError(error, timeoutMs) {
  const message = error?.message || String(error);
  const code = error?.code;

  if (error?.name === 'AbortError' || /aborted/i.test(message)) {
    return `Request timeout after ${timeoutMs}ms`;
  }
  if (code === 401 || /\b401\b/.test(String(message)) || /unauthorized/i.test(message)) {
    return 'Auth failed (HTTP 401): check the Authorization header or API key';
  }
  if (typeof code === 'number' && code > 0) {
    return `HTTP ${code}: ${message}`;
  }
  if (typeof code === 'string' && code) {
    return `${code}: ${message}`;
  }
  return message;
}

function findInvalidServerNames(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { typeError: 'Config must be a JSON object' };
  }
  if (config.mcpServers == null) {
    return { names: [] };
  }
  if (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    return { typeError: 'mcpServers must be an object of server name to config' };
  }
  return {
    names: Object.keys(config.mcpServers).filter((name) => !SERVER_NAME_PATTERN.test(name))
  };
}

function invalidNamesError(names) {
  const listed = names.map((name) => JSON.stringify(name)).join(', ');
  const noun = names.length === 1 ? 'name' : 'names';
  return `Invalid MCP server ${noun} ${listed}: the gateway rejects this config (${INVALID_NAME_HINT}). Saving it would make MetaMCP reject the reload and crash-loop.`;
}

async function probeMcpServer(serverName, serverConfig = {}) {
  const result = {
    name: serverName,
    reachable: false,
    error: null,
    tools: [],
    transportType: serverConfig.transportType || 'http'
  };

  if (!SERVER_NAME_PATTERN.test(serverName)) {
    result.error = `Invalid name: gateway rejects this config (${INVALID_NAME_HINT})`;
    return result;
  }

  if (serverConfig.command || (serverConfig.transportType || '').toLowerCase() === 'stdio') {
    result.error = 'stdio transport - not probeable from UI';
    return result;
  }

  if (!serverConfig.url) {
    result.error = 'No URL configured';
    return result;
  }

  let url;
  try {
    url = new URL(serverConfig.url);
  } catch {
    result.error = 'Invalid URL configured';
    return result;
  }

  const timeoutMs = serverConfig.timeoutMs || 15000;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const requestInit = {
    headers: substituteEnv(serverConfig.headers),
    signal: abortController.signal
  };
  const transport = (serverConfig.transportType || '').toLowerCase() === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
  const client = new Client({ name: 'mentu-metamcp-ui-probe', version: '1.0.0' });

  try {
    await client.connect(transport, { timeout: timeoutMs, signal: abortController.signal });
    result.reachable = true;
    const { tools } = await client.listTools(undefined, { timeout: timeoutMs, signal: abortController.signal });
    result.tools = (tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || ''
    }));
  } catch (error) {
    result.reachable = false;
    result.tools = [];
    result.error = formatProbeError(error, timeoutMs);
  } finally {
    clearTimeout(timer);
    try {
      await transport.terminateSession?.();
    } catch {
      // Session teardown is best-effort; the probe result already stands.
    }
    try {
      await client.close();
    } catch {
      // Ignore close errors after a failed handshake.
    }
  }

  return result;
}

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/config', authenticate, async (req, res) => {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf8');
    res.json({ content });
  } catch (error) {
    if (error.code === 'ENOENT') {
      const defaultConfig = JSON.stringify({ mcpServers: {} }, null, 2);
      await fs.writeFile(CONFIG_PATH, defaultConfig, 'utf8');
      res.json({ content: defaultConfig });
    } else {
      res.status(500).json({ error: `Failed to read config: ${error.message}` });
    }
  }
});

app.post('/api/config', authenticate, async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      return res.status(400).json({ error: `Invalid JSON: ${error.message}` });
    }

    const invalid = findInvalidServerNames(parsed);
    if (invalid.typeError) {
      return res.status(400).json({ error: invalid.typeError });
    }
    if (invalid.names.length > 0) {
      return res.status(400).json({ error: invalidNamesError(invalid.names) });
    }

    await fs.writeFile(CONFIG_PATH, content, 'utf8');

    res.json({
      success: true,
      message: 'Config saved successfully. MetaMCP will reload automatically.'
    });
  } catch (error) {
    res.status(500).json({ error: `Failed to save config: ${error.message}` });
  }
});

app.get('/api/servers/status', authenticate, async (req, res) => {
  try {
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

    const results = await Promise.all(
      Object.entries(servers).map(([name, serverConfig]) => probeMcpServer(name, serverConfig))
    );

    res.json({ servers: results });
  } catch (error) {
    res.status(500).json({ error: `Failed to get server status: ${error.message}` });
  }
});

function startServer() {
  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`MetaMCP UI running on port ${PORT}`);
    console.log(`Config path: ${CONFIG_PATH}`);
    console.log(`Authentication: ${BEARER_TOKEN ? 'Enabled' : 'DISABLED - SET METAMCP_HTTP_BEARER_TOKEN'}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  probeMcpServer,
  substituteEnv,
  SERVER_NAME_PATTERN,
  findInvalidServerNames,
  startServer
};
