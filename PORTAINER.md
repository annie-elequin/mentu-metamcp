# Portainer Deployment Guide

Deploy MetaMCP as a Git-based stack in Portainer.

## Prerequisites

- Portainer instance with access to Docker or Swarm environment
- Git repository access (this repo: `https://github.com/annie-elequin/mentu-metamcp`)
- A secure bearer token for authentication

## Deployment Steps

### 1. Generate Bearer Token

Generate a secure random token for authentication:

```bash
openssl rand -hex 32
```

Save this token - you'll need it for Portainer environment variables AND client MCP configuration.

### 2. Create Stack in Portainer

1. Navigate to **Stacks** in your Portainer dashboard
2. Click **Add stack**
3. Choose **Git Repository** as the build method
4. Configure the repository:
   - **Repository URL**: `https://github.com/annie-elequin/mentu-metamcp`
   - **Repository reference**: `refs/heads/main`
   - **Compose path**: `docker-compose.yml`

### 3. Configure Environment Variables

Add the following environment variables in the **Environment variables** section:

**Required:**
- `METAMCP_HTTP_BEARER_TOKEN`: Your generated bearer token (from step 1)

**Optional:**
- `METAMCP_ALLOWED_ORIGINS`: Comma-separated CORS origins (e.g., `https://example.com,https://app.example.com`)
- `METAMCP_PORT`: Host port mapped to MetaMCP (default `8080`). Set this in the stack env when host port 8080 already clashes.
- `UI_PORT`: Host port mapped to the config UI (default `3000`). Set this in the stack env when host port 3000 already clashes.

Container listen ports stay fixed (`8080` / `3000`); only the published host ports change.

### 4. Deploy Stack

1. Click **Deploy the stack**
2. Wait for Portainer to:
   - Clone the repository
   - Build both Docker images (`mentu-metamcp` and `mentu-metamcp-ui`)
   - Start the containers
3. Check the stack logs to verify both services started successfully

### 5. Access the Config UI

1. Find the UI container's published port (default: 3000, or whatever you set in `UI_PORT`)
2. Open `http://your-portainer-host:<UI_PORT>` in your browser
3. Enter your bearer token (same as `METAMCP_HTTP_BEARER_TOKEN`)
4. Click **Load Config** to load the current `.mcp.json`
5. Click **Refresh** in the Server Status panel to check health and discover tools from each configured MCP
6. Edit your configurations using the CodeMirror editor with line numbers and collapsible sections
7. Click **Save Config** - MetaMCP will reload automatically

**UI Features:**
- **Server Health Monitor**: Visual status (green/red) showing which servers are reachable
- **Tool Discovery**: Lists available tools from each reachable server
- **CodeMirror Editor**: Line numbers, JSON folding, syntax highlighting
- **Format/Validate**: Built-in JSON formatting and validation

## Using MetaMCP with MCP Clients

Configure your MCP client (Cursor, Claude Desktop, etc.) to connect via Streamable HTTP:

```json
{
  "mcpServers": {
    "metamcp": {
      "url": "http://your-portainer-host:8080/mcp",
      "transportType": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

Replace:
- `your-portainer-host` with your actual hostname or IP
- `8080` with your `METAMCP_PORT` if you overrode it
- `YOUR_BEARER_TOKEN_HERE` with your bearer token from step 1

## Configuration Format

Edit `.mcp.json` through the UI using this format:

```json
{
  "mcpServers": {
    "your-service": {
      "url": "https://your-service.example.com/mcp",
      "transportType": "http",
      "headers": {
        "Authorization": "Bearer ${YOUR_SERVICE_TOKEN}"
      }
    }
  }
}
```

**Important**: Use `${VAR}` syntax for secrets - MetaMCP substitutes environment variables at runtime.

## Port Configuration

Default host ports:
- **8080**: MetaMCP HTTP transport endpoint (`/mcp`) — override with `METAMCP_PORT`
- **3000**: Config UI — override with `UI_PORT`

Set `METAMCP_PORT` / `UI_PORT` in the Portainer stack environment when those defaults clash. Do not change the container-side ports in compose.

## Updating the Stack

To update after changes to the Git repository:

1. Go to **Stacks** in Portainer
2. Select your MetaMCP stack
3. Click **Update the stack**
4. Check **Pull latest image** (though images are built from Git, not pulled)
5. Click **Update**

Portainer will rebuild from the latest Git commit and restart the stack.

**Note**: Recent updates added `uv` and `uvx` to the gateway image for stdio child MCPs like the official Portainer MCP (`uvx --from mcp-portainer portainer-mcp`). Redeploy the stack to pick up these binaries.

## Troubleshooting

### Services won't start
- Check stack logs for error messages
- Verify `METAMCP_HTTP_BEARER_TOKEN` is set in environment variables
- If ports 8080 or 3000 are already in use, set `METAMCP_PORT` / `UI_PORT` in the stack env to free host ports

### UI shows "Unauthorized"
- Verify you're using the correct bearer token (same as `METAMCP_HTTP_BEARER_TOKEN`)
- Check browser console for specific error messages

### MetaMCP connection fails
- Verify the service is running: check container logs
- Test connectivity: `curl -H "Authorization: Bearer YOUR_TOKEN" http://your-host:<METAMCP_PORT>/health`
- Check firewall rules and port accessibility

### Config changes not taking effect
- MetaMCP watches the config file and reloads automatically
- If issues persist, restart the `mentu-metamcp` container from Portainer
- Check container logs for reload messages or errors

## Security Notes

- **Never commit** `.env` or real `.mcp.json` files with secrets to Git
- Store your bearer token securely (password manager, secrets vault)
- Use HTTPS in production (reverse proxy with SSL termination)
- Restrict network access to MetaMCP ports using firewall rules
- Rotate bearer tokens periodically
