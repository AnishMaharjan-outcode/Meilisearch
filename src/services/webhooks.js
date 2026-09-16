import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const BC_STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const BC_ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const WEBHOOK_AUTH_TOKEN = process.env.WEBHOOK_AUTH_TOKEN;

function getBcHeaders() {
    const accessToken = process.env.BIGCOMMERCE_ACCESS_TOKEN || BC_ACCESS_TOKEN;
    return {
        'X-Auth-Token': accessToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

export async function fetchExistingWebhooks() {
    const storeHash = process.env.BIGCOMMERCE_STORE_HASH || BC_STORE_HASH;
    const res = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`, {
        headers: getBcHeaders()
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch existing webhooks: ${res.statusText}`);
    }
    const data = await res.json();
    return data.data || [];
}

async function registerWebhook(destinationUrl, scope) {
    const storeHash = process.env.BIGCOMMERCE_STORE_HASH || BC_STORE_HASH;
    const webhookToken = process.env.WEBHOOK_AUTH_TOKEN || WEBHOOK_AUTH_TOKEN;

    const body = {
        scope,
        destination: destinationUrl,
        is_active: true
    };

    if (webhookToken) {
        body.headers = {
            'X-Webhook-Token': webhookToken
        };
    }

    const res = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/hooks`, {
        method: 'POST',
        headers: getBcHeaders(),
        body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`BigCommerce API error ${res.status}: ${JSON.stringify(data)}`);
    }
    return data.data;
}

export async function registerAllWebhooks(destinationUrl) {
    if (!destinationUrl) {
        throw new Error('Destination URL is required to register webhooks.');
    }

    const cleanDest = destinationUrl.replace(/\/+$/, '');
    const existingWebhooks = await fetchExistingWebhooks();
    const results = [];

    for (const scope of scopes) {
        const duplicate = existingWebhooks.find(h => 
            h.scope === scope && (h.destination || '').replace(/\/+$/, '') === cleanDest
        );
        if (duplicate) {
            results.push({
                scope,
                status: 'already_registered',
                id: duplicate.id,
                destination: cleanDest
            });
            continue;
        }

        try {
            const hook = await registerWebhook(destinationUrl, scope);
            results.push({
                scope,
                status: 'registered',
                id: hook.id,
                destination: destinationUrl
            });
        } catch (err) {
            results.push({
                scope,
                status: 'failed',
                error: err.message,
                destination: destinationUrl
            });
        }
    }

    return results;
}
