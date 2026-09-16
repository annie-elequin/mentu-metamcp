#!/bin/sh
set -e

# Validate required bearer token
if [ -z "$METAMCP_HTTP_BEARER_TOKEN" ]; then
  echo "ERROR: METAMCP_HTTP_BEARER_TOKEN is required but not set"
  exit 1
fi

# Initialize .mcp.json if it doesn't exist
if [ ! -f /config/.mcp.json ]; then
  echo '{"mcpServers":{}}' > /config/.mcp.json
  echo "Initialized empty /config/.mcp.json"
fi

# Build command with optional CORS origins
CMD="metamcp --transport http --host 0.0.0.0 --port 8080 --config /config/.mcp.json"

# Add allow-origin flags if METAMCP_ALLOWED_ORIGINS is set
if [ -n "$METAMCP_ALLOWED_ORIGINS" ]; then
  # Split CSV and add --allow-origin for each
  IFS=',' read -ra ORIGINS <<< "$METAMCP_ALLOWED_ORIGINS"
  for origin in "${ORIGINS[@]}"; do
    # Trim whitespace
    origin=$(echo "$origin" | xargs)
    if [ -n "$origin" ]; then
      CMD="$CMD --allow-origin $origin"
    fi
  done
fi

echo "Starting metamcp with command: $CMD"
exec $CMD
