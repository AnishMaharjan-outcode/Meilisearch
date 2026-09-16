import express from 'express';
import { meiliFetch } from '../services/meilisearch.js';
import { checkBigCommerceHealth } from '../services/bigcommerce.js';

const router = express.Router();

// 1. Fast health check (Ideal for Render's automated deployment and load balancer probes)
router.get('/', async (req, res) => {
  if (req.query.checkup === 'true') {
    return runDetailedCheckup(req, res);
  }

  res.json({
    status: 'ok',
    service: 'foamorder-meilisearch-sync',
    uptime: `${process.uptime().toFixed(1)}s`,
    timestamp: new Date().toISOString()
  });
});

// 2. Comprehensive checkup API (/health/checkup)
router.get('/checkup', async (req, res) => {
  return runDetailedCheckup(req, res);
});

async function runDetailedCheckup(req, res) {
  const checkup = {
    status: 'ok',
    service: 'foamorder-meilisearch-sync',
    timestamp: new Date().toISOString(),
    uptime: `${process.uptime().toFixed(1)}s`,
    memoryUsageMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
    checks: {
      server: { status: 'healthy' },
      environment: { status: 'checking' },
      meilisearchCloud: { status: 'checking' },
      bigcommerce: { status: 'checking' }
    }
  };

  // Environment variables validation
  const missingEnv = [];
  if (!process.env.MEILISEARCH_URL) missingEnv.push('MEILISEARCH_URL');
  if (!process.env.MEILI_MASTER_KEY) missingEnv.push('MEILI_MASTER_KEY');
  if (!process.env.BIGCOMMERCE_STORE_HASH) missingEnv.push('BIGCOMMERCE_STORE_HASH');
  if (!process.env.BIGCOMMERCE_ACCESS_TOKEN) missingEnv.push('BIGCOMMERCE_ACCESS_TOKEN');

  if (missingEnv.length > 0) {
    checkup.checks.environment = {
      status: 'warning',
      message: `Missing required env variables: ${missingEnv.join(', ')}`
    };
  } else {
    checkup.checks.environment = { status: 'healthy', configured: true };
  }

  // Meilisearch Cloud Connectivity
  try {
    const meiliHealth = await meiliFetch('/health');
    checkup.checks.meilisearchCloud = {
      status: 'healthy',
      host: process.env.MEILISEARCH_URL,
      response: meiliHealth
    };
  } catch (err) {
    checkup.status = 'degraded';
    checkup.checks.meilisearchCloud = {
      status: 'error',
      message: err.message
    };
  }

  // BigCommerce API Connectivity
  try {
    const bcSummary = await checkBigCommerceHealth();
    checkup.checks.bigcommerce = {
      status: 'healthy',
      storeHash: process.env.BIGCOMMERCE_STORE_HASH,
      productCount: bcSummary?.data?.product_count ?? 'accessible'
    };
  } catch (err) {
    checkup.status = 'degraded';
    checkup.checks.bigcommerce = {
      status: 'error',
      message: err.message
    };
  }

  const statusCode = checkup.status === 'ok' ? 200 : 503;
  return res.status(statusCode).json(checkup);
}

export default router;