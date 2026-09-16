# BigCommerce to Meilisearch Sync & Webhook Service

A production integration service designed to synchronize product catalog changes from **BigCommerce** to **Meilisearch Cloud** in real-time. Built for zero-downtime deployment on **Render**, it includes on-demand and scheduled full-catalog syncs, atomic index swapping, dynamic search key provisioning, diagnostic checkup APIs, and real-time webhook ingestion.

---

## 🚀 Key Features

* **Real-time Incremental Sync**: Captures BigCommerce catalog events (`product/created`, `product/updated`, `product/deleted`) via webhooks and updates Meilisearch Cloud in under 2 seconds.
* **On-Demand Cloud Reindexing (`POST /sync`)**: Trigger a full catalog sync anytime via an authenticated API endpoint with an async background runner and real-time status tracking (`/sync/status`).
* **Weekly Automated Cron Sync**: Runs automatically every **Saturday at 1:00 AM US Eastern Time** (Richmond, VA timezone) via an integrated cron scheduler with shared concurrency locking.
* **Atomic Index Swapping**: Full catalog syncs build in an isolated temporary index (`product_index_tmp`) and atomically swap with `product_index` in milliseconds—zero downtime for storefront search.
* **Full System Checkup API (`GET /health/checkup`)**: Diagnostic endpoint testing Meilisearch Cloud connectivity, BigCommerce credentials, and environment configurations.
* **Secure API Key Provisioning (`GET /meili/key`)**: Serves a scoped read-only (search-only) key to frontend clients, keeping your master Meilisearch key private.
* **Optimized & Resilient**: Automatic rate-limit handling with exponential backoff on BigCommerce API, 5-minute in-memory caching for categories and brands, and URL sanitization.
* **Render & Cloud-Native**: Streamlined Node.js runtime setup without local Docker dependencies.

---

## 🛠️ Prerequisites

* **Node.js** (v18 or higher recommended)
* **Yarn** or **NPM**
* **Meilisearch Cloud** Project URL (`https://ms-xxxx.meilisearch.io`) and Admin API Key
* **BigCommerce Store API Credentials** (`BIGCOMMERCE_STORE_HASH` and `BIGCOMMERCE_ACCESS_TOKEN`)

---

## 📦 Getting Started

### 1. Environment Configuration

Create a `.env` file in the root directory (based on `.env.example`):

```ini
# BigCommerce API Connection Credentials
BIGCOMMERCE_STORE_HASH=your_bigcommerce_store_hash
BIGCOMMERCE_ACCESS_TOKEN=your_bigcommerce_access_token

# Meilisearch Cloud Settings
MEILISEARCH_URL=https://your-project-url.meilisearch.io
MEILI_MASTER_KEY=your_meilisearch_cloud_admin_key

# Webhook Security Token (Shared secret for POST /webhook and POST /sync)
WEBHOOK_AUTH_TOKEN=your_secure_webhook_auth_token

# Express App Server Configurations (Local Dev)
APP_PORT=4000
```

### 2. Install Dependencies

```bash
yarn install
```

### 3. Run the Server Locally

```bash
yarn dev
```
The server will boot with hot-reloading enabled, listening on `http://localhost:4000`.

---

## 🚀 Deploying to Render

1. **Create Web Service**:
   * Connect this repository to your **Render** dashboard.
   * **Runtime**: `Node`
   * **Build Command**: `yarn install`
   * **Start Command**: `yarn start`
   * **Health Check Path**: `/health`

2. **Configure Environment Variables** in Render Dashboard:
   * `BIGCOMMERCE_STORE_HASH`
   * `BIGCOMMERCE_ACCESS_TOKEN`
   * `MEILISEARCH_URL` (Meilisearch Cloud project endpoint)
   * `MEILI_MASTER_KEY` (Meilisearch Cloud Admin API Key)
   * `WEBHOOK_AUTH_TOKEN` (Shared secret string)

> [!NOTE]
> **Render Plan Tier Recommendation**:
> To ensure the weekly cron re-indexer (`scheduler.js`) runs reliably every Saturday at 1:00 AM Eastern Time and incoming BigCommerce webhooks do not experience cold-start delays, the Render **Starter** tier ($7/mo) is recommended. On the free tier, web services spin down after 15 minutes of inactivity.

---

## 🔄 Running the Full Catalog Sync

You can run a full catalog re-index in three ways:

### Option A: Via API Endpoint (Recommended for Cloud / Render)
Send an authenticated POST request to trigger the sync in the background:
```bash
curl -X POST https://your-service-name.onrender.com/sync \
     -H "X-Webhook-Token: your_secure_webhook_auth_token"
```

Check the sync status at any time:
```bash
curl https://your-service-name.onrender.com/sync/status
```

### Option B: Via Local Terminal
Make sure your local `.env` has your Meilisearch Cloud credentials, then run:
```bash
yarn sync
```

### Option C: Via Render Shell
Open your web service in the Render Dashboard, open the **Shell** tab, and run:
```bash
yarn sync
```

---

## 🪝 Registering Webhooks in BigCommerce

To sync products in real time whenever they are created, updated, or deleted in BigCommerce, trigger the registration endpoint:

```bash
curl -X POST https://your-service.onrender.com/webhook/register \
     -H "X-Webhook-Token: your_secure_webhook_auth_token"
```

* Automatically detects your Render domain and configures the webhook destination URL.
* Registers `store/product/created`, `store/product/updated`, and `store/product/deleted`.
* Secured with your `X-Webhook-Token` header.

You can also list all active registered webhooks anytime:
```bash
curl https://your-service.onrender.com/webhook/registered \
     -H "X-Webhook-Token: your_secure_webhook_auth_token"
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| **GET** | `/health` | No | Fast probe for Render deploy and load balancer health checks. |
| **GET** | `/health/checkup` | No | Diagnostic test verifying Meilisearch Cloud, BigCommerce API, and env credentials. |
| **POST** | `/sync` | Yes (`X-Webhook-Token` or Bearer) | Triggers on-demand full catalog sync in the background. |
| **GET** | `/sync/status` | No | Returns the current state, progress, and history of catalog syncs. |
| **POST** | `/webhook` | Yes (`X-Webhook-Token`) | Receives real-time product updates from BigCommerce. |
| **POST** | `/webhook/register` | Yes (`X-Webhook-Token`) | Registers product webhooks (`created`, `updated`, `deleted`) with BigCommerce. |
| **GET** | `/webhook/registered` | Yes (`X-Webhook-Token`) | Lists all currently active webhooks on your BigCommerce store. |
| **GET** | `/meili/stats` | No | Returns document counts and database stats from Meilisearch Cloud. |
| **GET** | `/webhook/logs` | No | Downloads the `webhook.log` trace file. |
| **GET** | `/logs` | No | Shortcut alias to download `webhook.log`. |

---

## 📂 Project Structure

```text
├── src/
│   ├── routes/
│   │   ├── index.js             # Central routing tree
│   │   ├── health.js            # /health & /health/checkup diagnostic endpoints
│   │   ├── meili.js             # /meili/stats endpoint
│   │   ├── sync.js              # /sync trigger & status API
│   │   └── webhook.js           # /webhook receiver, registration & logs endpoints
│   ├── services/
│   │   ├── bigcommerce.js       # BigCommerce API client, rate limiter & cache
│   │   ├── meilisearch.js       # Meilisearch Cloud fetch client & key generator
│   │   ├── logger.js            # Safe file and console logger
│   │   ├── scheduler.js         # Weekly full catalog cron runner
│   │   ├── sync.js              # Full catalog re-indexing engine & product transformer
│   │   └── webhooks.js          # BigCommerce webhook registration & listing service
│   └── server.js                # Express app initialization & port binding
├── package.json                 # Project dependencies and npm scripts
└── webhook.log                  # Local webhook execution log (gitignored)
```
