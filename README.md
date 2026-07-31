# Social Link Tracker 🚀

A production-ready Telegram Bot that monitors Facebook, Instagram, TikTok, and YouTube URLs and notifies Telegram users when their status changes.

## Features
- **Add/Remove Links**: Track various social media profiles or specific videos/pages.
- **Automated Checking**: Runs every 10 minutes to verify link status.
- **Telegram Notifications**: Instantly alerts users on status changes.
- **History Tracking**: Keeps a log of status changes for every tracked link.
- **API**: Includes a built-in Express API for health checks and external integrations.

## Supported Platforms
- Facebook (Profile, Page)
- Instagram (Profile)
- TikTok (Account)
- YouTube (Channel, Video)

## Tech Stack
- **Node.js 22+**
- **Express** (API)
- **Telegraf** (Telegram Bot Framework)
- **PostgreSQL** (Database)
- **Prisma ORM**
- **Axios & Playwright/Cheerio** (Scraping)
- **node-cron** (Scheduling)
- **Winston** (Logging)
- **Docker & Docker Compose** (Containerization)

## Prerequisites
- Node.js 22 or higher
- Docker & Docker Compose
- A Telegram Bot Token from [@BotFather](https://t.me/botfather)

## Installation & Configuration

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/social-link-tracker.git
   cd social-link-tracker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Copy `.env.example` to `.env` and configure your variables:
   ```bash
   cp .env.example .env
   ```
   Update `.env` with your `BOT_TOKEN` and `DATABASE_URL`.

## Running Locally

### With Docker (Recommended)
You can spin up the entire stack (Node app + PostgreSQL) using Docker Compose:
```bash
docker-compose up --build
```

### Without Docker
1. Ensure you have a running PostgreSQL instance and update `DATABASE_URL` in `.env`.
2. Push the Prisma schema:
   ```bash
   npm run db:push
   # or npm run db:generate
   ```
3. Start the application:
   ```bash
   npm run dev
   # or for production: npm start
   ```

## Deploying

### Ubuntu VPS (with Docker)
1. SSH into your VPS.
2. Clone this repository.
3. Configure your `.env` file.
4. Run `docker-compose up -d --build`.

### Railway / Render
1. Connect your GitHub repository.
2. Add the required environment variables.
3. Add a PostgreSQL add-on and link the `DATABASE_URL`.
4. Deploy!

## Usage (Telegram Commands)
- `/start` - Start the bot
- `/help` - Show help message
- `/add <url>` - Add a new link to monitor
- `/remove <url>` - Remove a monitored link
- `/list` - List all your monitored links
- `/check <url>` - Manually check a specific link
- `/status` - Show current status of all your links
- `/history <url>` - Show history of a link

## License
This project is licensed under the MIT License.
