const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const configPath = path.join(os.tmpdir(), `metamcp-ui-probe-${process.pid}.json`);
fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }, null, 2));
process.env.CONFIG_PATH = configPath;
process.env.METAMCP_HTTP_BEARER_TOKEN = 'probe-test-token';
process.env.PROBE_TEST_TOKEN = 'secret-from-env';

const { startMockMcpServer, startUnauthorizedServer } = require('./helpers');
const {
  app,
  probeMcpServer,
  substituteEnv,
  SERVER_NAME_PATTERN,
  findInvalidServerNames
} = require('../server');

const TOKEN = process.env.METAMCP_HTTP_BEARER_TOKEN;
let mockMcp;
let unauthorized;
let uiServer;
let uiPort;

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      hostname: '127.0.0.1',
      port: uiPort,
      path: pathname,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  mockMcp = await startMockMcpServer();
  unauthorized = await startUnauthorizedServer();
  uiServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => uiServer.once('listening', resolve));
  uiPort = uiServer.address().port;
});

after(async () => {
  await new Promise((resolve) => uiServer.close(resolve));
  await mockMcp.close();
  await unauthorized.close();
  try {
    fs.unlinkSync(configPath);
  } catch {
    // ignore
  }
});

test('substitutes ${VAR} in headers and leaves unknown vars', () => {
  assert.deepEqual(
    substituteEnv({
      Authorization: 'Bearer ${PROBE_TEST_TOKEN}',
      'X-Missing': 'keep-${MISSING_VAR}'
    }),
    {
      Authorization: 'Bearer secret-from-env',
      'X-Missing': 'keep-${MISSING_VAR}'
    }
  );
});

test('gateway server-name rule matches letters, digits, . _ -', () => {
  assert.equal(SERVER_NAME_PATTERN.test('beeper'), true);
  assert.equal(SERVER_NAME_PATTERN.test('home-assistant'), true);
  assert.equal(SERVER_NAME_PATTERN.test('mcp.1_ok'), true);
  assert.equal(SERVER_NAME_PATTERN.test('my server'), false);
  assert.equal(SERVER_NAME_PATTERN.test('-leading'), false);
  assert.equal(SERVER_NAME_PATTERN.test(''), false);
});

test('probe of a Streamable HTTP server reports reachable with tools', async () => {
  const result = await probeMcpServer('example', {
    url: mockMcp.url,
    timeoutMs: 10000
  });
  assert.equal(result.reachable, true, result.error);
  assert.equal(result.error, null);
  assert.equal(result.tools.some((tool) => tool.name === 'greet'), true);
  assert.match(result.tools.find((tool) => tool.name === 'greet').description, /greeting/i);
});

test('probe of a 401 server reports a clear auth error', async () => {
  const result = await probeMcpServer('needs-auth', {
    url: unauthorized.url,
    timeoutMs: 5000
  });
  assert.equal(result.reachable, false);
  assert.match(result.error, /Auth failed \(HTTP 401\)/i);
});

test('probe flags names the gateway would reject', async () => {
  const result = await probeMcpServer('bad name', { url: mockMcp.url });
  assert.equal(result.reachable, false);
  assert.match(result.error, /Invalid name/i);
  assert.doesNotMatch(result.error, /timeout/i);
});

test('GET /api/servers/status probes in parallel and includes ok, 401, and invalid name', async () => {
  const config = {
    mcpServers: {
      example: { url: mockMcp.url, timeoutMs: 10000 },
      locked: { url: unauthorized.url, timeoutMs: 5000 },
      'bad name': { url: mockMcp.url, timeoutMs: 5000 }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const started = Date.now();
  const response = await request('/api/servers/status');
  const elapsed = Date.now() - started;

  assert.equal(response.status, 200, response.text);
  const byName = Object.fromEntries(response.json.servers.map((server) => [server.name, server]));

  assert.equal(byName.example.reachable, true, byName.example.error);
  assert.equal(byName.example.tools.some((tool) => tool.name === 'greet'), true);
  assert.match(byName.locked.error, /Auth failed \(HTTP 401\)/i);
  assert.match(byName['bad name'].error, /Invalid name/i);
  // Sequential 5s timeouts would be much slower; parallel should finish well under that.
  assert.ok(elapsed < 8000, `status took ${elapsed}ms; probes may have run sequentially`);
});

test('POST /api/config rejects invalid server names and does not write', async () => {
  const before = fs.readFileSync(configPath, 'utf8');
  const response = await request('/api/config', {
    method: 'POST',
    body: {
      content: JSON.stringify({
        mcpServers: {
          'my server': { url: 'http://127.0.0.1:9/mcp' }
        }
      }, null, 2)
    }
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error, /Invalid MCP server name/);
  assert.match(response.json.error, /my server/);
  assert.doesNotMatch(response.json.error || '', /reload automatically/i);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('POST /api/config accepts valid names', async () => {
  const content = JSON.stringify({
    mcpServers: {
      example: { url: mockMcp.url, timeoutMs: 10000 }
    }
  }, null, 2);
  const response = await request('/api/config', {
    method: 'POST',
    body: { content }
  });
  assert.equal(response.status, 200, response.text);
  assert.match(response.json.message, /reload automatically/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), content);
});

test('findInvalidServerNames reports type errors for non-object mcpServers', () => {
  assert.deepEqual(findInvalidServerNames({ mcpServers: [] }).typeError, 'mcpServers must be an object of server name to config');
  assert.equal(findInvalidServerNames({ mcpServers: { ok: {} } }).names.length, 0);
});
