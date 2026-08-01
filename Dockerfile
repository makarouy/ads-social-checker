FROM node:22-slim

WORKDIR /app

# Install OpenSSL and CA certificates which Prisma requires
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

# Install Playwright Chromium browser and OS dependencies
RUN npx playwright install --with-deps chromium

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

CMD ["npm", "run", "start"]
