import express from 'express';
import healthRoute from './health.js';
import meiliRoute from './meili.js';
import webhookRoute from './webhook.js';

const router = express.Router();

// Mount individual sub-routers
router.use('/health', healthRoute);
router.use('/meili', meiliRoute);
router.use('/webhook', webhookRoute);

export default router;
