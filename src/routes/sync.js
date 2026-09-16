import express from 'express';
import { main as runSync } from '../services/sync.js';
import { log, logSpacer } from '../services/logger.js';

const router = express.Router();

let isSyncRunning = false;
let lastSyncStartedAt = null;
let lastSyncCompletedAt = null;
let lastSyncStatus = 'idle'; // 'idle' | 'running' | 'completed' | 'failed'
let lastSyncError = null;

// Middleware to authenticate sync requests using WEBHOOK_AUTH_TOKEN
const validateSyncToken = (req, res, next) => {
    const configuredToken = process.env.WEBHOOK_AUTH_TOKEN;
    if (!configuredToken) {
        return next();
    }

    // Support both X-Webhook-Token header and standard Authorization: Bearer <token>
    const headerToken = req.headers['x-webhook-token'];
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    const token = headerToken || bearerToken;

    if (token !== configuredToken) {
        log(`🔒 Sync trigger unauthorized: Missing or invalid token.`, 'API-SYNC');
        logSpacer();
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or missing authentication token. Provide X-Webhook-Token or Authorization: Bearer <token>.'
        });
    }

    next();
};

export function getSyncState() {
    return {
        isRunning: isSyncRunning,
        status: lastSyncStatus,
        lastStartedAt: lastSyncStartedAt,
        lastCompletedAt: lastSyncCompletedAt,
        lastError: lastSyncError
    };
}

export async function executeCatalogSync(context = 'MANUAL') {
    if (isSyncRunning) {
        throw new Error(`A catalog sync is already currently running (started at ${lastSyncStartedAt}).`);
    }

    isSyncRunning = true;
    lastSyncStartedAt = new Date().toISOString();
    lastSyncStatus = 'running';
    lastSyncError = null;

    try {
        await runSync(context);
        lastSyncStatus = 'completed';
        lastSyncCompletedAt = new Date().toISOString();
        log(`✅ ${context} full catalog sync completed successfully.`, context);
        return { success: true };
    } catch (error) {
        lastSyncStatus = 'failed';
        lastSyncError = error.message;
        lastSyncCompletedAt = new Date().toISOString();
        log(`❌ ${context} full catalog sync failed: ${error.message}`, context);
        throw error;
    } finally {
        isSyncRunning = false;
    }
}

// GET /sync/status (or GET /sync) - Check sync status
router.get('/', (req, res) => {
    res.json(getSyncState());
});

router.get('/status', (req, res) => {
    res.json(getSyncState());
});

// POST /sync - Trigger a full catalog sync in the background
router.post('/', validateSyncToken, async (req, res) => {
    if (isSyncRunning) {
        return res.status(409).json({
            error: 'Conflict',
            message: 'A catalog sync is already currently running.',
            startedAt: lastSyncStartedAt
        });
    }

    log('🚀 Full catalog sync triggered via API endpoint (POST /sync)', 'API-SYNC');

    // Respond immediately to the client so the HTTP connection does not time out
    res.status(202).json({
        message: 'Full catalog sync started successfully in the background.',
        startedAt: new Date().toISOString(),
        checkStatusUrl: '/sync/status'
    });

    // Run the sync asynchronously in the background using the unified executor
    executeCatalogSync('API-SYNC').catch(() => {});
});

export default router;

