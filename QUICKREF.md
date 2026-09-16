# MetaMCP Portainer Stack - Quick Reference

## Repository
**GitHub**: https://github.com/annie-elequin/mentu-metamcp

## Files Added (12 files, 1053 insertions)

### Core Services
- `docker-compose.yml` - Build-only compose (mentu-metamcp + mentu-metamcp-ui services)
- `metamcp/Dockerfile` - MetaMCP container (Node 20, @mentu/metamcp@1.0.0, includes uv/uvx for stdio MCPs)
- `metamcp/entrypoint.sh` - Validates bearer token, builds CLI flags, inits config
- `ui/Dockerfile` - Config editor container (Node 20 + Express)
- `ui/server.js` - API server (load/save config, bearer auth)
- `ui/public/index.html` - Web UI (textarea editor, JSON validation, format)
- `ui/package.json` - Dependencies (express@^4.18.2)

### Configuration
- `.env.example` - Environment template (bearer token, CORS origins)
- `config/.mcp.json.example` - Example configs (Home Assistant, Portainer, BookStack, memos, TidyHQ, Synology placeholders)
- `.gitignore` - Excludes .env, real .mcp.json, node_modules

### Documentation
- `README.md` - Full docs (architecture, local dev, troubleshooting)
- `PORTAINER.md` - Portainer deployment steps (Git stack creation, env vars, client config)

## Portainer Deployment (3 steps)

1. **Create Stack** from Git:
   - Repo: `https://github.com/annie-elequin/mentu-metamcp`
   - Branch: `refs/heads/main`
   - Compose: `docker-compose.yml`

2. **Set Environment**:
   - `METAMCP_HTTP_BEARER_TOKEN`: Generate with `openssl rand -hex 32`
   - `METAMCP_ALLOWED_ORIGINS`: (optional) CSV of CORS origins

3. **Deploy** → Portainer builds images → services start

## Access

- **Config UI**: `http://your-host:3000` (enter bearer token, load/save .mcp.json)
- **MetaMCP endpoint**: `http://your-host:8080/mcp`

## MCP Client Config (Cursor / Claude Desktop)

```json
{
  "mcpServers": {
    "metamcp": {
      "url": "http://your-host:8080/mcp",
      "transportType": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

Replace:
- `your-host` with Portainer hostname/IP
- `YOUR_BEARER_TOKEN_HERE` with your generated token

## Key Features

✅ **Build-only compose** - No registry pulls (Portainer Git stack requirement)  
✅ **Stdio MCP support** - Includes uv/uvx for stdio children like `uvx --from mcp-portainer portainer-mcp`  
✅ **Fail-closed auth** - Container exits if bearer token missing  
✅ **Auto-reload** - MetaMCP watches config file, reloads on save  
✅ **Shared volume** - `/config` mounted in both containers  
✅ **JSON validation** - UI validates before saving  
✅ **Secret substitution** - Use `${VAR}` in .mcp.json for env vars  
✅ **CORS support** - Optional origins via `METAMCP_ALLOWED_ORIGINS`  

## Gotchas

❌ **Do NOT use** `image:` pull names in compose (breaks Portainer Git stacks)  
❌ **Do NOT proxy** Affine/Fastmail/Linear/Slack/GitHub (use direct MCP)  
❌ **Do NOT commit** real .env or .mcp.json with secrets  

## Architecture

```
MCP Client (Bearer auth)
    ↓ Streamable HTTP
MetaMCP :8080/mcp ← reads → Shared Volume /config/.mcp.json
                                 ↑ writes
                            Config UI :3000 (Bearer auth)
```

## Security Checklist

- [ ] Generated strong bearer token (`openssl rand -hex 32`)
- [ ] Token set in Portainer environment variables
- [ ] Same token used in client MCP config
- [ ] UI accessed over HTTPS in production (reverse proxy)
- [ ] Firewall rules restrict port access if needed
- [ ] Secrets in .mcp.json use `${VAR}` substitution (not hardcoded)

## Testing

1. Deploy in Portainer
2. Check logs: `mentu-metamcp` and `mentu-metamcp-ui` containers running
3. Open UI: `http://host:3000`, enter token, click Load Config
4. Save a test change → verify mentu-metamcp logs show reload
5. Add client config, test tools list from MCP client

---

**Everything is on main** - Ready for Portainer Git stack deployment.
