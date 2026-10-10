FROM node:20-alpine

# Build version arg (forces rebuild when changed)
ARG BUILD_VERSION=dev
LABEL build.version="${BUILD_VERSION}"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public ./public

# Create config directory
RUN mkdir -p /config

EXPOSE 3000

CMD ["node", "server.js"]
