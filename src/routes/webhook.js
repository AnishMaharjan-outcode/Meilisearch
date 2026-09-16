import express from 'express';
import { fetchProduct, fetchBrands, fetchCategories } from '../services/bigcommerce.js';
import { meiliFetch } from '../services/meilisearch.js';
import { transformProduct, buildCategoryPaths } from '../services/sync.js';
import { registerAllWebhooks, fetchExistingWebhooks } from '../services/webhooks.js';
import { log, logSpacer, getLogFilePath, logExists } from '../services/logger.js';

const router = express.Router();
const INDEX_NAME = 'product_index';

// Middleware to validate secure webhook token
const validateWebhookToken = (req, res, next) => {
    const configuredToken = process.env.WEBHOOK_AUTH_TOKEN;
    if (!configuredToken) {
        return next();
    }

    const incomingToken = req.headers['x-webhook-token'];
    if (incomingToken !== configuredToken) {
        log(`🔒 Webhook unauthorized: 'X-Webhook-Token' header is missing or invalid. Received: "${incomingToken || '(none)'}"`, 'WEBHOOK');
        logSpacer();
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid webhook token.' });
    }

    next();
};

// POST /webhook - Process BigCommerce webhook event
router.post('/', validateWebhookToken, async (req, res) => {
    const { scope, data } = req.body;
    const productId = data?.id;
    
    // Log the incoming webhook event
    log(`📥 Received BigCommerce webhook event: Scope: "${scope}", ID: ${productId}`, 'WEBHOOK');

    // Immediately respond to BigCommerce to avoid timing out
    res.json({ received: true });

    // Process the webhook payload asynchronously in the background
    (async () => {
        try {
            if (!productId) {
                log('⚠️ Webhook payload did not contain a valid product ID.', 'WEBHOOK');
                return;
            }

            if (scope === 'store/product/deleted') {
                log(`🗑️ Processing product deletion for ID: ${productId}`, 'WEBHOOK');
                try {
                    await meiliFetch(`/indexes/${INDEX_NAME}/documents/${productId}`, 'DELETE');
                    log(`✅ Successfully deleted product ${productId} from Meilisearch.`, 'WEBHOOK');
                } catch (err) {
                    if (err.message.includes('document_not_found') || err.message.includes('404')) {
                        log(`ℹ️ Product ${productId} was already deleted or not found in Meilisearch.`, 'WEBHOOK');
                    } else {
                        throw err;
                    }
                }
            } else if (scope === 'store/product/updated' || scope === 'store/product/created') {
                log(`🔄 Processing product sync for ID: ${productId}`, 'WEBHOOK');

                // Wait 2 seconds to allow BigCommerce API database to write the changes and avoid race conditions
                await new Promise(resolve => setTimeout(resolve, 2000));

                // 1. Fetch single product details from BigCommerce
                let product;
                try {
                    product = await fetchProduct(productId);
                } catch (err) {
                    if (err.message.includes('404')) {
                        log(`⚠️ Product ${productId} not found in BigCommerce (might have been deleted). Removing from Meilisearch.`, 'WEBHOOK');
                        await meiliFetch(`/indexes/${INDEX_NAME}/documents/${productId}`, 'DELETE').catch(() => {});
                        return;
                    }
                    throw err;
                }

                if (!product) {
                    log(`⚠️ Product ${productId} returned empty data from BigCommerce.`, 'WEBHOOK');
                    return;
                }

                log(`   └─ Fetched details for product: "${product.name}" (SKU: ${product.sku}, Visible: ${product.is_visible})`, 'WEBHOOK');

                // If product is not visible, remove it from Meilisearch index so it doesn't show up in search results
                if (product.is_visible === false) {
                    log(`   └─ Product is marked invisible. Deleting from Meilisearch index.`, 'WEBHOOK');
                    await meiliFetch(`/indexes/${INDEX_NAME}/documents/${productId}`, 'DELETE').catch(() => {});
                    return;
                }

                // 2. Fetch brands and categories mappings (cached)
                log(`   └─ Fetching brands and categories from cache/API...`, 'WEBHOOK');
                const [brands, categories] = await Promise.all([
                    fetchBrands(),
                    fetchCategories()
                ]);

                const brandMap = Object.fromEntries(brands.map(b => [b.id, b.name]));
                const catPaths = buildCategoryPaths(categories);

                // 3. Transform product to search index schema
                log(`   └─ Normalizing and transforming product schema...`, 'WEBHOOK');
                const document = transformProduct(product, brandMap, catPaths);

                // 4. Upsert into Meilisearch
                log(`   └─ Pushing document to Meilisearch...`, 'WEBHOOK');
                const response = await meiliFetch(`/indexes/${INDEX_NAME}/documents`, 'POST', [document]);
                log(`✅ Successfully updated/created product "${product.name}" (ID: ${productId}) in Meilisearch. Task UID: ${response.taskUid}`, 'WEBHOOK');
            } else {
                log(`ℹ️ Webhook scope "${scope}" ignored.`, 'WEBHOOK');
            }
        } catch (error) {
            log(`❌ Error processing webhook event for product ID ${productId}: ${error.message}`, 'WEBHOOK');
        } finally {
            // Write a spacer of 1 empty line at the end of this webhook event run
            logSpacer();
        }
    })();
});

// GET /webhook/logs - Download log file
router.get('/logs', (req, res) => {
    if (!logExists()) {
        return res.status(404).json({ error: 'Log file not found. No webhooks processed yet.' });
    }
    
    res.download(getLogFilePath(), 'webhook.log', (err) => {
        if (err) {
            console.error('Error sending log file:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to download log file.' });
            }
        }
    });
});

// GET /webhook/registered - List currently active BigCommerce webhooks
router.get('/registered', validateWebhookToken, async (req, res) => {
    try {
        const hooks = await fetchExistingWebhooks();
        res.json({ total: hooks.length, webhooks: hooks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

let isRegisteringWebhooks = false;

// POST /webhook/register - Register product webhooks with BigCommerce
router.post('/register', validateWebhookToken, async (req, res) => {
    if (isRegisteringWebhooks) {
        return res.status(409).json({
            error: 'Conflict',
            message: 'Webhook registration is already in progress. Please wait a moment.'
        });
    }

    isRegisteringWebhooks = true;
    try {
        let destination = req.body?.destination;
        let scopes = req.body?.scopes;

        if (!destination) {
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const host = req.get('host');
            destination = `${protocol}://${host}/webhook`;
        }

        log(`Registering webhooks with destination: ${destination}`, 'WEBHOOK-REG');
        const results = await registerAllWebhooks(destination, scopes);
        res.json({ destination, results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        isRegisteringWebhooks = false;
    }
});

export default router;
