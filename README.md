# mentu-metamcp

Portainer Git stack for [Mentu MetaMCP](https://github.com/mentu-ai/metamcp) - aggregate long-tail HTTP MCP servers behind one endpoint with a simple web-based config editor.

## What is this?

This stack provides:

1. **MetaMCP HTTP transport** - Aggregates multiple remote HTTP MCP servers into one endpoint
2. **Config UI** - Web-based editor for `.mcp.json` with bearer token authentication
3. **Portainer-ready** - Designed as a Git-based stack with build-only compose (no registry pulls)

Connect your MCP client (Cursor, Claude Desktop, etc.) to one MetaMCP endpoint, edit your upstream server list through the UI, and MetaMCP handles the rest.

## Use Case

MetaMCP is perfect for long-tail services that have HTTP MCP endpoints:
- Home Assistant
- Portainer MCP
- BookStack
- Memos
- TidyHQ
- Synology
- Custom internal services

**Do NOT proxy** through MetaMCP:
- Affine
- Fastmail
- Linear
- Slack
- GitHub

These first-party services work better as direct MCP connections.

## Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### 1. Clone and Configure

```bash
git clone https://github.com/annie-elequin/mentu-metamcp.git
cd mentu-metamcp

# Copy example env file
cp .env.example .env

# Generate a secure bearer token
openssl rand -hex 32

# Edit .env and set METAMCP_HTTP_BEARER_TOKEN
nano .env
```

### 2. Start the Stack

```bash
docker compose up -d
```

This will:
- Build both images (`metamcp` and `ui`)
- Create a shared `config` volume
- Start both services with restart policies
- Expose MetaMCP on port 8080 and UI on port 3000

### 3. Configure via UI

1. Open http://localhost:3000
2. Enter your bearer token (from `.env`)
3. Click **Load Config**
4. Edit the JSON configuration
5. Click **Save Config**

MetaMCP watches the config file and reloads automatically.

### 4. Connect Your MCP Client

Add to your MCP client config (e.g., Cursor, Claude Desktop):

```json
{
  "mcpServers": {
    "metamcp": {
      "url": "http://localhost:8080/mcp",
      "transportType": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

## Portainer Deployment

See **[PORTAINER.md](./PORTAINER.md)** for complete Portainer deployment instructions.

**Quick summary:**
1. Add stack from Git: `https://github.com/annie-elequin/mentu-metamcp`
2. Set environment variable: `METAMCP_HTTP_BEARER_TOKEN`
3. Deploy stack (builds images from Git)
4. Access UI at `http://your-host:3000`
5. Configure client to connect to `http://your-host:8080/mcp`

## Configuration Format

The `.mcp.json` file uses MetaMCP's remote HTTP children format:

```json
{
  "mcpServers": {
    "your-service-name": {
      "url": "https://your-service.example.com/mcp",
      "transportType": "http",
      "headers": {
        "Authorization": "Bearer ${YOUR_SERVICE_TOKEN}"
      }
    },
    "another-service": {
      "url": "http://internal-service:8080/api/mcp",
      "transportType": "http",
      "headers": {
        "X-API-Key": "${ANOTHER_TOKEN}"
      }
    }
  }
}
```

**Environment Variable Substitution**: Use `${VAR}` syntax for secrets. MetaMCP reads from the container environment at runtime.

See `config/.mcp.json.example` for more examples.

## Architecture

```
┌─────────────────┐
│   MCP Client    │
│ (Cursor/Claude) │
└────────┬────────┘
         │ Streamable HTTP
         │ Bearer Auth
         ▼
┌─────────────────┐
│    MetaMCP      │  Port 8080
│  Aggregator     │  /mcp endpoint
└────────┬────────┘
         │ Reads config
         │
         ▼
┌─────────────────┐
│  Shared Volume  │
│   /config/      │
│  .mcp.json      │
└────────┬────────┘
         │ Edits config
         ▼
┌─────────────────┐
│   Config UI     │  Port 3000
│  (Express + UI) │  Bearer Auth
└─────────────────┘
```

## Services

### `metamcp`
- Node 20 Alpine
- Runs `@mentu/metamcp@1.0.0`
- Exposes HTTP transport on port 8080
- Watches `/config/.mcp.json` for changes
- Fails closed if `METAMCP_HTTP_BEARER_TOKEN` is not set

### `ui`
- Node 20 Alpine
- Simple Express server + static HTML
- Bearer token authentication (same token as MetaMCP)
- Load/save API for `/config/.mcp.json`
- JSON validation and formatting

### Shared Volume
- Named volume `config`
- Mounted at `/config` in both containers
- Persists `.mcp.json` across restarts

## Environment Variables

### Required
- `METAMCP_HTTP_BEARER_TOKEN` - Bearer token for authentication (generate with `openssl rand -hex 32`)

### Optional
- `METAMCP_ALLOWED_ORIGINS` - Comma-separated CORS origins (e.g., `https://example.com,https://app.example.com`)

## Development

### Structure

```
mentu-metamcp/
├── docker-compose.yml       # Compose file with build-only services
├── .env.example             # Example environment variables
├── .gitignore               # Ignores secrets and node_modules
├── README.md                # This file
├── PORTAINER.md             # Portainer deployment guide
├── config/
│   └── .mcp.json.example    # Example MCP server configurations
├── metamcp/
│   ├── Dockerfile           # MetaMCP container
│   └── entrypoint.sh        # Startup script with validation
└── ui/
    ├── Dockerfile           # UI container
    ├── package.json         # Node dependencies
    ├── server.js            # Express server
    └── public/
        └── index.html       # Config editor UI
```

### Local Development (without Docker)

**Terminal 1 - MetaMCP:**
```bash
npm install -g @mentu/metamcp@1.0.0
export METAMCP_HTTP_BEARER_TOKEN="your-token-here"
mkdir -p config
echo '{"mcpServers":{}}' > config/.mcp.json
metamcp --transport http --host 0.0.0.0 --port 8080 --config ./config/.mcp.json
```

**Terminal 2 - UI:**
```bash
cd ui
npm install
export METAMCP_HTTP_BEARER_TOKEN="your-token-here"
mkdir -p ../config
node server.js
```

### Validate Compose

```bash
docker compose config
```

## Security

- Bearer token authentication on all endpoints (MetaMCP + UI)
- Secrets via environment variables only (never in Git)
- Config UI validates JSON before saving
- MetaMCP fails closed if bearer token is not set
- Use HTTPS in production (reverse proxy recommended)

## Troubleshooting

**MetaMCP won't start:**
- Check `METAMCP_HTTP_BEARER_TOKEN` is set
- View logs: `docker compose logs metamcp`

**UI shows "Unauthorized":**
- Verify bearer token matches `METAMCP_HTTP_BEARER_TOKEN`
- Check browser console for errors

**Config changes not applying:**
- MetaMCP auto-reloads when config file changes
- Check metamcp logs for reload messages
- Restart if needed: `docker compose restart metamcp`

**Can't connect from MCP client:**
- Verify endpoint: `http://your-host:8080/mcp`
- Test health: `curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8080/health`
- Check bearer token in client config matches container env

## License

This stack is a deployment wrapper. See [MetaMCP](https://github.com/mentu-ai/metamcp) for the upstream license.

## Related

- [Mentu MetaMCP](https://github.com/mentu-ai/metamcp) - The upstream MetaMCP aggregator
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
