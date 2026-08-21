import express from 'express';
import { getOrCreateSearchOnlyKey, meiliFetch } from '../services/meilisearch.js';

const router = express.Router();

// Simple memory cache for IP-to-Timezone mapping
const ipTzCache = new Map();

/**
 * Resolves the client's timezone based on their public IP address
 */
async function getTimezoneFromIp(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
        // Local system default fallback
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    
    if (ipTzCache.has(ip)) {
        return ipTzCache.get(ip);
    }
    
    try {
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,timezone`);
        if (response.ok) {
            const data = await response.json();
            if (data && data.status === 'success' && data.timezone) {
                ipTzCache.set(ip, data.timezone);
                return data.timezone;
            }
        }
    } catch (e) {
        // Silently fail and fall back to UTC
    }
    return 'UTC';
}

// GET /meili/key - Get or create search-only key
router.get('/key', async (req, res) => {
    try {
        const { key, created } = await getOrCreateSearchOnlyKey();
        res.json({
            created,
            message: created ? 'New search-only key created.' : 'Existing search-only key returned.',
            key: key.key,
            uid: key.uid,
            description: key.description,
            actions: key.actions,
            indexes: key.indexes
        });
    } catch (err) {
        console.error('Error getting/creating Meilisearch key:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET /meili/stats - Get Meilisearch database statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await meiliFetch('/stats');
        
        // 1. Resolve client IP address
        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        if (ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }
        if (ip.startsWith('::ffff:')) {
            ip = ip.substring(7);
        }

        // 2. Resolve client timezone (query param -> header -> IP lookup -> fallback)
        let tz = req.query.tz || req.headers['x-timezone'];
        if (!tz) {
            tz = await getTimezoneFromIp(ip);
        }

        // 3. Format the lastUpdate timestamp in human-readable local time
        let lastUpdateFormatted = null;
        let timezone = null;

        if (stats.lastUpdate) {
            try {
                const date = new Date(stats.lastUpdate);
                lastUpdateFormatted = date.toLocaleString('en-US', {
                    timeZone: tz,
                    dateStyle: 'long',
                    timeStyle: 'medium'
                });
                timezone = tz;
            } catch (formatErr) {
                // If the timezone name is invalid, fall back to formatting in UTC
                const date = new Date(stats.lastUpdate);
                lastUpdateFormatted = date.toLocaleString('en-US', {
                    timeZone: 'UTC',
                    dateStyle: 'long',
                    timeStyle: 'medium'
                });
                timezone = 'UTC (Fallback)';
            }
        }

        // Destructure to place the massive indexes object at the very end
        const { indexes, ...restStats } = stats;
        const responseData = {
            ...restStats,
            lastUpdateFormatted,
            timezone,
            indexes
        };

        res.json(responseData);
    } catch (err) {
        console.error('Error fetching Meilisearch stats:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
