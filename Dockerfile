# Dockerfile for Javinizer-js
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application files
COPY . .

# Create config directory
RUN mkdir -p /config

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV CONFIG_PATH=/config/config.json

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/item/config', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "src/server/server.js"]
