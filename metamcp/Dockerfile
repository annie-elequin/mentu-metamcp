FROM node:20-alpine

WORKDIR /app

# Install metamcp at pinned version
RUN npm install -g @mentu/metamcp@1.0.0

# Create config directory
RUN mkdir -p /config

# Healthcheck endpoint script
RUN echo 'const http = require("http"); const server = http.createServer((req, res) => { if (req.url === "/health") { res.writeHead(200); res.end("OK"); } }); server.listen(8081);' > /app/health.js

# Entrypoint script to validate required env and start metamcp
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
