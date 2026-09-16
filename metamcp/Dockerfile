FROM node:20-alpine

WORKDIR /app

# Install metamcp at pinned version
RUN npm install -g @mentu/metamcp@1.0.0

# Create config directory
RUN mkdir -p /config

# Entrypoint script to validate required env and start metamcp
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
