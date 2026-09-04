FROM node:20-bookworm-slim

# Install Chromium and dependencies required for headless browser automation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    fonts-ipafont-gothic \
    fonts-kacst \
    fonts-thai-tlwg \
    fonts-wqy-zenhei \
    procps \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Configure Puppeteer to use the installed Chromium binary
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000 \
    WHATSAPP_HEADLESS=true

WORKDIR /app

# Install dependencies using clean install for reproducible builds
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/.wwebjs_auth /app/.wwebjs_cache

EXPOSE 3000

CMD ["node", "index.js"]
