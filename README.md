# BigCommerce to Meilisearch Sync & Webhook Service

An optimized integration service designed to synchronize product catalog changes from **BigCommerce** to **Meilisearch** in real-time. It includes a full-catalog sync command, a built-in cron scheduler, secure search key provisioning, and a webhook endpoint for incremental updates.

---

## 🚀 Key Features

*   **Real-time Incremental Sync**: Captures BigCommerce catalog events (`product/created`, `product/updated`, `product/deleted`) via webhooks and syncs them to Meilisearch in under 2 seconds.
*   **Weekly Full Catalog Reindexing**: Runs automatically every **Saturday at 1:00 AM US Eastern Time** (Richmond, VA timezone) via an integrated cron scheduler.
*   **Secure API Key Provisioning**: Serves a dynamic read-only (search-only) key to frontend clients, keeping your master Meilisearch key private.
*   **DRY & Optimized Performance**: Unified BigCommerce and Meilisearch HTTP services featuring a 5-minute TTL cache on categories and brands.
*   **Structured Logging**: Appends detailed sync traces with UTC timestamps to a local `webhook.log` (gitignored), grouped and separated for easy analysis.

---

## 🛠️ Prerequisites

*   **Node.js** (v18 or higher recommended)
*   **Yarn** or **NPM**
*   **Docker** (to run the local Meilisearch container)

---

## 📦 Getting Started

### 1. Environment Configuration
Create a `.env` file in the root directory (based on `.env.example`) and configure the following parameters:

```ini
# BigCommerce Credentials
BIGCOMMERCE_STORE_HASH=your_store_hash
BIGCOMMERCE_ACCESS_TOKEN=your_api_token

# Meilisearch Configurations
MEILISEARCH_URL=http://localhost:7000
MEILI_PORT=7000
MEILI_MASTER_KEY=your_secure_master_key
MEILI_ENV=development

# Express App Configurations
APP_PORT=4000
```

### 2. Start Meilisearch via Docker
Spin up the local Meilisearch container:
```bash
docker-compose up -d
```
*   This launches Meilisearch at `http://localhost:7000`.
*   Data is persisted in the local `./meili_data` directory (gitignored).

### 3. Install Dependencies
```bash
yarn install
```

### 4. Run the Express Server
```bash
yarn dev
```
The server will boot and initialize the weekly cron scheduler, listening on `http://localhost:4000`.

---

## 🔄 Running the Initial Full Sync

To populate your Meilisearch index with all active products from your BigCommerce store, run the manual indexing script:
```bash
npm run sync
```
This script will delete any existing index configuration, apply Meilisearch settings (searchable, filterable, and sortable fields), fetch all brands, categories, and products, transform them, and batch-upload them in groups of 500.

---

## 🪝 Registering Webhooks in BigCommerce

To sync products in real-time, you must register your public webhook destination URL with BigCommerce.

Run the registration script, passing in your public server URL:
```bash
node src/scripts/register_webhooks.js https://<your-public-server-url>/webhook
```
This registers `store/product/created`, `store/product/updated`, and `store/product/deleted` scopes with BigCommerce.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/health` | Server health status check. |
| **GET** | `/meili/key` | Safely retrieves or generates a search-only read key for the frontend. |
| **GET** | `/meili/stats` | Retrieves current statistics for all indexes in Meilisearch. |
| **POST** | `/webhook` | Receives BigCommerce catalog updates and schedules background sync. |
| **GET** | `/webhook/logs` | Downloads the `webhook.log` file containing detailed sync execution traces. |
| **GET** | `/logs` | Shortcut alias endpoint to download `webhook.log` directly. |

---

## 📂 Project Structure

```text
├── meili_data/               # Persistent Meilisearch docker volume (gitignored)
├── src/
│   ├── routes/
│   │   ├── index.js          # Central router mounting all routes
│   │   ├── health.js         # /health endpoint
│   │   ├── meili-key.js      # /meili-key provisioner
│   │   └── webhook.js        # /webhook & /logs receiver and processor
│   ├── scripts/
│   │   ├── register_webhooks.js # CLI tool to register hooks with BigCommerce
│   │   └── sync.js           # Full catalog re-indexer
│   ├── services/
│   │   ├── bigcommerce.js    # BigCommerce API client & memory cache
│   │   ├── meilisearch.js    # Meilisearch core fetch helper
│   │   └── scheduler.js      # Weekly full catalog cron runner
│   └── server.js             # Express application bootstrapper
├── docker-compose.yml        # Docker configuration for Meilisearch container
├── package.json              # Project script and dependency manifests
└── webhook.log               # Server-generated webhook logs file (gitignored)
```
