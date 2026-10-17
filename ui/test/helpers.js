const http = require('http');
const { randomUUID } = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');

function listen(appOrServer) {
  return new Promise((resolve) => {
    const httpServer = appOrServer.listen(0, '127.0.0.1', () => {
      const { port } = httpServer.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () => new Promise((done, reject) => {
          httpServer.close((error) => (error ? reject(error) : done()));
        })
      });
    });
  });
}

function createGreetingServer() {
  const server = new McpServer({ name: 'probe-mock', version: '1.0.0' });
  server.registerTool('greet', {
    description: 'A simple greeting tool'
  }, async () => ({
    content: [{ type: 'text', text: 'hello' }]
  }));
  return server;
}

/**
 * Session-based Streamable HTTP MCP server (SDK example shape).
 * A bare POST of tools/list without initialize + Mcp-Session-Id returns 400.
 */
async function startMockMcpServer() {
  const app = createMcpExpressApp();
  const sessions = new Map();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    try {
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (session) {
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport });
          }
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        const mcpServer = createGreetingServer();
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (sessionId) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null
        });
        return;
      }
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error.message || 'Internal server error' },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && sessions.get(sessionId);
    if (!session) {
      res.status(400).send('Missing or unknown session ID');
      return;
    }
    await session.transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && sessions.get(sessionId);
    if (!session) {
      res.status(400).send('Missing or unknown session ID');
      return;
    }
    await session.transport.handleRequest(req, res);
  });

  return listen(app);
}

async function startUnauthorizedServer() {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  });
  return listen(server);
}

module.exports = {
  startMockMcpServer,
  startUnauthorizedServer
};
