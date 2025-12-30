# Minimal Dockerfile - only essential dependencies
FROM node:18-slim

# Install ONLY essential Chromium dependencies for headless mode
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libxss1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --production --quiet \
    && npm cache clean --force

# Copy application files
COPY src ./src
COPY data ./data
COPY scrapers ./scrapers

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create directories
RUN mkdir -p /config /app/data/scrape /app/data/actors

EXPOSE 4004

ENV NODE_ENV=production \
    CONFIG_PATH=/config/config.json \
    LIBRARY_PATH=/library

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4004/item/config', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "src/server/index.js"]
