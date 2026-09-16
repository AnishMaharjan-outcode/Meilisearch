import express from 'express';
import { meiliFetch } from '../services/meilisearch.js';

const router = express.Router();

// GET /meili/stats - Get Meilisearch database statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await meiliFetch('/stats');
        res.json(stats);
    } catch (err) {
        console.error('Error fetching Meilisearch stats:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
