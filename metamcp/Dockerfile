# Multi-stage build: copy uv and uvx from official Astral image
FROM ghcr.io/astral-sh/uv:latest AS uv

FROM node:20-alpine

WORKDIR /app

# Copy uv and uvx binaries from Astral image
COPY --from=uv /uv /uvx /usr/local/bin/

# Install metamcp at pinned version
RUN npm install -g @mentu/metamcp@1.0.0

# BUGFIX 1: Upgrade MCP SDK to fix compatibility with Python MCP SDK 2.2+ (protocol eras)
# Must uninstall first to force replacement
RUN cd /usr/local/lib/node_modules/@mentu/metamcp && \
    npm uninstall @modelcontextprotocol/sdk && \
    npm install @modelcontextprotocol/sdk@1.32.1 && \
    npm rebuild && \
    echo "Verifying SDK version..." && \
    node -p "require('@modelcontextprotocol/sdk/package.json').version"

# BUGFIX 2: Fix session ID reuse between era probe and legacy fallback
# When probing for modern era fails, the transport has a stale session ID
# from the server (mcp4immich terminates failed sessions). Must create fresh
# transport for legacy fallback to avoid "Session not found" errors.
COPY patches/apply-session-fix.sh /tmp/apply-session-fix.sh
RUN chmod +x /tmp/apply-session-fix.sh && \
    /tmp/apply-session-fix.sh && \
    rm /tmp/apply-session-fix.sh

# Create config directory
RUN mkdir -p /config

# Entrypoint script to validate required env and start metamcp
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
