# Minimal Dockerfile - only essential dependencies
FROM node:20-slim

# Install Chromium with all dependencies needed for headless mode + Xvfb
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    xvfb \
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
COPY docker-entrypoint.sh ./

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

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

# Start server with smart display detection
CMD ["./docker-entrypoint.sh"]
