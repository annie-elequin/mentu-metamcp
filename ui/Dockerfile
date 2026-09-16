FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY public ./public

# Create config directory
RUN mkdir -p /config

EXPOSE 3000

CMD ["node", "server.js"]
