# Cinema Party

A minimalist Telegram Mini App and bot for tracking movies together with friends, featuring an OLED dark mode, editorial serif headings, live movie search suggestions, and customizable accent colors.

---

## Architecture

- **Backend**: Cloudflare Worker (free plan, single global deployment, zero cold-sleep).
- **Database**: Cloudflare D1 (serverless SQLite at the edge).
- **Frontend**: Static Web Assets hosted directly via Workers Static Assets (`public/`). Pure ES modules, zero frontend build step.
- **Bot**: Telegram Webhook integrated into the Worker at `/telegram`.
- **Movie Catalog**: Open source movie search powered by Cinemeta (IMDb metadata, zero API keys required). Optional TMDB fallback.
- **Security**:
  - Full HMAC-SHA256 signature verification for Telegram `initData`.
  - Scoped data access: personal lists are read-only to others; shared movies editable by party members.
  - Poster URL allowlist and sanitized rendering.
  - Secrets stored exclusively in Cloudflare encrypted secrets (`wrangler secret put`).

---

## Project Structure

```
cinema-party/
  public/
    index.html            # Main HTML document
    app.js                # Frontend client logic & state
    styles.css            # Dark theme styling & CSS variables
    manifest.webmanifest  # PWA web manifest
    icon.svg              # App vector icon
    icon-512.png          # App icon (512x512 PNG for BotFather & Home Screen)
  src/
    worker.js             # Worker entrypoint, API router, asset handler
    auth.js               # Telegram initData signature validation & auth middleware
    db.js                 # D1 database queries & transactions
    telegram.js           # Telegram bot webhook handler
    movieSearch.js        # Open catalog movie search & suggestions
  migrations/
    0001_init.sql         # Initial D1 database schema
    0002_user_profile.sql # User avatars & display names
  scripts/
    setup.mjs             # Interactive setup helper
    set-webhook.mjs       # Webhook and chat menu button configurator
    backup.mjs            # D1 manual backup script
  test/
    auth.test.mjs         # Unit tests for signature verification
    api.test.mjs          # API integration tests
  wrangler.jsonc          # Cloudflare Worker configuration
  package.json
  README.md
  .gitignore
```

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Apply database migrations to local D1:
   ```bash
   npm run db:local
   ```

3. Start local development server:
   ```bash
   npm run dev
   ```
   The app will be accessible at `http://localhost:8787`.

4. Run tests:
   ```bash
   # Run authentication unit tests
   npm test

   # Run API integration tests (while wrangler dev is running)
   npm run test:api
   ```

---

## Deployment to Cloudflare (Free Tier)

### Step 1: Cloudflare Login
```bash
npx wrangler login
```

### Step 2: Create D1 Database
```bash
npx wrangler d1 create cinema-party
```
Copy the printed `database_id` and paste it into `wrangler.jsonc` under `d1_databases[0].database_id`.

### Step 3: Apply Migrations to Remote D1
```bash
npm run db:remote
```

### Step 4: Configure Secrets
Set the following secrets in Cloudflare (you will be prompted to type them securely):
```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
```
- `BOT_TOKEN`: Your Telegram bot token from @BotFather.
- `WEBHOOK_SECRET`: A random secret string of your choice (e.g. 32 alphanumeric characters) to authenticate incoming Telegram updates.
- Optional: `npx wrangler secret put TMDB_API_KEY` (if you want to also query TMDB in addition to the open movie catalog).

### Step 5: Deploy the Worker
```bash
npm run deploy
```
Wrangler will output your production HTTPS URL, for example:
`https://cinema-party.<your-subdomain>.workers.dev`

### Step 6: Configure Telegram Webhook and Menu Button
Run the helper script:
```bash
node scripts/set-webhook.mjs <WORKER_URL> <BOT_TOKEN> <WEBHOOK_SECRET>
```
This sets the webhook to `<worker-url>/telegram` and adds the permanent "Movies" button in the bot chat.

### Step 7: Configure @BotFather (Bot Avatar & Native Home Screen Shortcut)
1. **Set Bot Avatar**:
   - In [@BotFather](https://t.me/BotFather), send `/setuserpic`, select your bot, and send `bot-avatar.png` (or `public/icon-512.png`).
2. **Register Mini App for Native Home Screen**:
   - Send `/newapp` (or `/editapp`).
   - Select your bot (`@cine_party_bot`).
   - Enter title (`Cinema Party`) and short description.
   - Upload the 512x512 app icon (`public/icon-512.png`).
   - (Optional demo: send `/empty`).
   - Provide the Web App URL: `https://cinema-party.<your-subdomain>.workers.dev`.
   - Choose a short name, for example `cinema`.
   - BotFather will provide the direct Mini App link: `https://t.me/your_bot_username/cinema`.
   - Opening this link in Telegram enables the native **"Add to Home Screen"** option in Telegram's top `⋮` menu, allowing one-tap installation on Android and iOS desktop!
3. Put your bot username and short name into `wrangler.jsonc`:
   ```jsonc
   "vars": {
     "BOT_USERNAME": "your_bot_username",
     "APP_SHORT_NAME": "cinema"
   }
   ```
   and redeploy (`npm run deploy`).

---

## Database Backups

To create a complete SQL dump of your remote production database:
```bash
npm run backup
```
The file will be saved to `backups/backup-<timestamp>.sql`.
