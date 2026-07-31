FROM node:22-alpine AS builder

WORKDIR /app

# Install OS dependencies required for Playwright (if using full Playwright browsers)
# Note: Since Playwright browsers are huge, we might just install the chromium dependencies if we run headlessly
# For a lighter footprint, you can use playwright-core or specific browser packages.
# Here we'll install deps for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Prune dev dependencies for production if you have a build step, but this is a bot.
# RUN npm prune --production

CMD ["npm", "run", "start"]
