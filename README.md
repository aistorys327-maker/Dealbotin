# ⚡ DealsBot India - Automated Affiliate Deals & Admin Dashboard

An automated deals aggregator and broadcast bot designed for the Indian e-commerce ecosystem (**Amazon India**, **Flipkart**, and **Shopsy**). Runs serverless on **Netlify**, stores deduplicated state in **Netlify Blobs** (zero external database required), and includes a mobile-first dark-mode **Admin Dashboard**.

---

## 🌟 Key Features

- **Automated Netlify Scheduled Function**: Triggers every 30 minutes (`*/30 * * * *`) without needing any external server.
- **Multi-Source Ingestion**:
  - **Amazon India (Amazon.in)** via **PA-API 5.0** with AWS Signature Version 4 authentication.
  - **Flipkart & Shopsy** via Flipkart Affiliate API Deals of the Day (DOTD) & Search feeds.
  - Separate `try/catch` isolation: one platform outage never affects the other.
- **Smart Filtering & Loot Detection**:
  - Configurable minimum discount percentage (default: 40%).
  - Pricing anomaly filter: deals with >90% discount or < ₹100 are automatically skipped unless verified by the "Trust Rule" (brand authentication) to prevent junk/spam listings.
  - Automatic check for valid product images, prices, and links.
- **48-Hour Deduplication via Netlify Blobs**:
  - Computes cryptographic SHA-256 hash of `source + product_id + price`.
  - Prevents posting the same product at the same price within 48 hours.
- **AI-Powered Hinglish Captions (Optional)**:
  - Generates viral 2-line Hinglish captions with emojis using Google Gemini (`gemini-3.8-flash`) via the modern `@google/genai` SDK.
  - Strict anti-hallucination rules (no fake coupons or false claims).
  - Falls back to a clean deal template if `GEMINI_API_KEY` is not provided.
- **Multi-Channel Broadcast**:
  - **Telegram Channel**: Sends photo with HTML caption and inline `🛒 Buy Now` button. Includes automatic retry on 429 rate limits and 1.5s post-spacing.
  - **Facebook Page (Optional)**: Posts image + caption via Facebook Graph API.
  - Statutory affiliate disclosure in every post: *"Affiliate link: we may earn a commission."*
- **IST Quiet Hours**:
  - Automatically pauses automated night-time notifications (default: 11:00 PM – 7:00 AM Indian Standard Time).
  - Can be enabled/disabled or scheduled directly from the dashboard.
- **Mobile-First Admin Dashboard**:
  - Tailored for 380px phone screens.
  - Protected by `ADMIN_PASSWORD` (stored strictly in `sessionStorage` on your phone).
  - Live engine trigger button (`⚡ Run Deals Engine Now`) with execution logs modal.
  - One-tap Telegram channel connectivity test (`📲 Test Telegram Channel`).
  - Deals history browser & live run logs.

---

## 📱 Note on Amazon India: PA-API 5.0 vs Creators API

> **Amazon API Status for India (Amazon.in):**
> Amazon has begun rolling out the *Amazon Creators API* alongside the classical *Product Advertising API (PA-API 5.0)*.
> - As of 2024–2026, **PA-API 5.0 remains the primary standard programmatic endpoint for Product Search and Deals in India (`webservices.amazon.in`, region `eu-west-1`)**.
> - This codebase includes a complete AWS Signature Version 4 implementation for PA-API 5.0 and formats all outbound affiliate links with your `tag=AMAZON_PARTNER_TAG`.
> - If any API credentials are unset or awaiting approval, DealsBot **gracefully skips that provider** and logs the status instead of crashing.

---

## 📲 Step-by-Step Deploy Guide for Phone Users (No PC Needed!)

You can deploy and manage this entire bot from a smartphone browser (Chrome/Safari) in under 10 minutes.

### Step 1: Get the Code onto GitHub
1. Open [github.com](https://github.com) on your phone and log in.
2. Create a new repository (e.g., `deals-bot-india`).
3. Push or upload this project to your repository.

---

### Step 2: Set Up Telegram Bot & Channel (3 Minutes)
1. Open the **Telegram app** on your phone.
2. Search for `@BotFather` and tap **Start**.
3. Send `/newbot`, give it a name (e.g. `My Deals Bot`) and a username ending in `bot` (e.g. `MyLootDeals_bot`).
4. Copy the **HTTP API Token** (e.g. `7123456789:AAHq...`). This is your `TELEGRAM_BOT_TOKEN`.
5. Create a new **Public or Private Telegram Channel** (e.g. `Best Indian Deals`).
6. Open your Channel settings -> **Administrators** -> **Add Admin** -> Search for your bot's username and add it with "Post Messages" permission.
7. Your `TELEGRAM_CHANNEL_ID` is your public handle (e.g. `@mydealschannel`) or private channel ID (e.g. `-100192837465`).

---

### Step 3: Deploy on Netlify from Your Phone
1. Go to [netlify.com](https://www.netlify.com) on your phone browser and tap **Log In with GitHub**.
2. Tap **Add new site** -> **Import an existing project**.
3. Select **GitHub** and pick your `deals-bot-india` repository.
4. Netlify will auto-detect settings from `netlify.toml`:
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
5. Tap **Deploy Site**.

---

### Step 4: Add Environment Variables in Netlify
1. In the Netlify dashboard on your phone, go to:
   **Site configuration** -> **Environment variables** -> **Add a variable**.
2. Add the following variables:

| Variable Name | Required? | Description |
| :--- | :---: | :--- |
| `ADMIN_PASSWORD` | **Yes** | Your private password for logging into the web dashboard. |
| `TELEGRAM_BOT_TOKEN` | **Yes** | Bot token from @BotFather. |
| `TELEGRAM_CHANNEL_ID` | **Yes** | Channel username (`@yourchannel`) or ID. |
| `AMAZON_ACCESS_KEY` | Optional | Amazon PA-API 5.0 Access Key. |
| `AMAZON_SECRET_KEY` | Optional | Amazon PA-API 5.0 Secret Key. |
| `AMAZON_PARTNER_TAG` | Optional | Your Amazon Associates Tracking ID (e.g., `deals0a-21`). |
| `FLIPKART_AFFILIATE_ID` | Optional | Your Flipkart Affiliate ID (e.g., `mydealsid`). |
| `FLIPKART_AFFILIATE_TOKEN` | Optional | Your Flipkart Affiliate API Token. |
| `GEMINI_API_KEY` | Optional | Free Google Gemini key from [aistudio.google.com](https://aistudio.google.com). |
| `FB_PAGE_ID` | Optional | Facebook Page ID (if auto-posting to Facebook). |
| `FB_PAGE_TOKEN` | Optional | Facebook Page Access Token. |

3. After adding the variables, tap **Deploys** -> **Trigger deploy** -> **Clear cache and deploy site**.

---

### Step 5: Test and Control from Your Phone
1. Open your Netlify site URL in your phone browser: `https://your-site-name.netlify.app`.
2. Enter your `ADMIN_PASSWORD` to unlock the dashboard.
3. Tap **📲 Test Telegram Channel** to verify that your bot posts a test message.
4. Tap **⚡ Run Deals Engine Now** to fetch, deduplicate, and post your first batch of live deals!
5. The scheduled function will automatically run **every 30 minutes** in the background.

---

## 🔒 Security Architecture

1. **Zero Secret Leakage**:
   - Secrets are **never** bundled in client JS or committed to GitHub.
   - All external APIs (Amazon, Flipkart, Telegram, Facebook, Gemini) are called exclusively inside backend Netlify Functions via `process.env`.
2. **Constant-Time Admin Authentication**:
   - All dashboard operations pass the `x-admin-password` header.
   - Verified on the server using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
3. **In-Memory Rate Limiting**:
   - Throttles brute-force attempts (max 6 failed attempts per minute per IP).
4. **Session-Only Credential Storage**:
   - Admin password is stored only in the browser's `sessionStorage` and cleared upon logout or browser tab closure.

---

## 📂 Project Structure

```text
├── .env.example                 # Template for environment variables
├── .gitignore                   # Ignores .env, node_modules, .cache, .netlify
├── netlify.toml                 # Netlify build, redirects, and 30-min cron config
├── package.json                 # Node dependencies
├── README.md                    # Mobile-friendly deploy instructions
├── server.ts                    # Local preview server (port 3000)
├── lib/
│   ├── store.js                 # Netlify Blobs storage & local dev fallback
│   ├── filter.js                # Normalization, discount filters, & trust rules
│   ├── amazon.js                # Amazon.in PA-API 5.0 with AWS V4 signing
│   ├── flipkart.js              # Flipkart & Shopsy affiliate API integration
│   ├── telegram.js              # Telegram photo posting, HTML captions, retries
│   ├── facebook.js              # Facebook Page Graph API poster
│   ├── gemini.js                # Google Gemini 3.8 Flash Hinglish caption generator
│   └── engine.js                # Deals engine runner & orchestrator
├── netlify/
│   └── functions/
│       ├── api.js               # Protected Admin HTTP API endpoints
│       └── scheduled-deals.js   # 30-minute scheduled background cron
└── public/
    ├── index.html               # Mobile-first admin dashboard
    ├── styles.css               # Clean dark-mode touch-friendly CSS
    └── app.js                   # Client-side API interactions & UI logic
```

---

## 🛠️ Local Development (AI Studio or Local Machine)

To run locally:
```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and configure variables
cp .env.example .env

# 3. Start development server (Port 3000)
npm run dev
```

Open `http://localhost:3000` in your browser. (If `ADMIN_PASSWORD` is not configured in `.env`, a default preview password `admin` is enabled).
