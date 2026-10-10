# Multi-stage build: copy uv and uvx from official Astral image
FROM ghcr.io/astral-sh/uv:latest AS uv

FROM node:20-alpine

WORKDIR /app

# Copy uv and uvx binaries from Astral image
COPY --from=uv /uv /uvx /usr/local/bin/

# Install metamcp at pinned version
RUN npm install -g @mentu/metamcp@1.0.0

# BUGFIX: Upgrade MCP SDK to fix compatibility with Python MCP SDK 2.2+ (protocol eras)
# The SDK v1.30.0 bundled in @mentu/metamcp@1.0.0 has compatibility issues with new servers
# like mcp4immich that use the modern stateless protocol (2026-07-28).
# We MUST remove the old SDK first, then install the new one, to ensure node resolves correctly.
RUN cd /usr/local/lib/node_modules/@mentu/metamcp && \
    npm uninstall @modelcontextprotocol/sdk && \
    npm install @modelcontextprotocol/sdk@1.32.1 && \
    npm rebuild && \
    echo "Verifying SDK version..." && \
    node -p "require('@modelcontextprotocol/sdk/package.json').version"

# Create config directory
RUN mkdir -p /config

# Entrypoint script to validate required env and start metamcp
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
