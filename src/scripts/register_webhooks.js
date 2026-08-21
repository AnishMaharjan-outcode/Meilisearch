import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const BC_STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const BC_ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const WEBHOOK_AUTH_TOKEN = process.env.WEBHOOK_AUTH_TOKEN;

// Expose a CLI argument or default value for the destination
const destinationUrl = process.argv[2];

if (!destinationUrl) {
    console.error('❌ Error: Please specify your public webhook destination URL.');
    console.error('Usage: node src/scripts/register_webhooks.js <your-public-url>/webhook');
    console.error('Example: node src/scripts/register_webhooks.js https://xxxx.ngrok-free.app/webhook');
    process.exit(1);
}

const bcHeaders = {
    'X-Auth-Token': BC_ACCESS_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

const scopes = [
    'store/product/created',
    'store/product/updated',
    'store/product/deleted'
];

async function fetchExistingWebhooks() {
    const res = await fetch(`https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/hooks`, {
        headers: bcHeaders
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch existing webhooks: ${res.statusText}`);
    }
    const data = await res.json();
    return data.data || [];
}

async function registerWebhook(scope) {
    console.log(`Registering webhook for scope: ${scope}...`);
    
    const body = {
        scope,
        destination: destinationUrl,
        is_active: true
    };

    if (WEBHOOK_AUTH_TOKEN) {
        body.headers = {
            'X-Webhook-Token': WEBHOOK_AUTH_TOKEN
        };
    }

    const res = await fetch(`https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/hooks`, {
        method: 'POST',
        headers: bcHeaders,
        body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`BigCommerce API error ${res.status}: ${JSON.stringify(data)}`);
    }
    console.log(`✅ Registered! Webhook ID: ${data.data.id}`);
}

async function main() {
    console.log(`Checking and registering webhooks to store: ${BC_STORE_HASH}`);
    console.log(`Destination: ${destinationUrl}\n`);

    let existingWebhooks = [];
    try {
        existingWebhooks = await fetchExistingWebhooks();
        console.log(`Fetched ${existingWebhooks.length} existing webhooks from BigCommerce.`);
    } catch (err) {
        console.warn('⚠️ Warning: Could not fetch existing webhooks. Proceeding to register anyway.', err.message);
    }
    
    for (const scope of scopes) {
        const duplicate = existingWebhooks.find(h => h.scope === scope && h.destination === destinationUrl);
        if (duplicate) {
            const currentToken = duplicate.headers ? duplicate.headers['X-Webhook-Token'] : undefined;
            if (WEBHOOK_AUTH_TOKEN && currentToken !== WEBHOOK_AUTH_TOKEN) {
                console.log(`⚠️ Webhook for scope "${scope}" already registered with ID: ${duplicate.id}, but has a different X-Webhook-Token. Skipping registration to avoid breaking other environments.`);
            } else {
                console.log(`ℹ️ Webhook for scope "${scope}" already registered with ID: ${duplicate.id}. Skipping.`);
            }
            continue;
        }

        try {
            await registerWebhook(scope);
        } catch (err) {
            console.error(`❌ Failed to register ${scope}:`, err.message);
        }
    }
}

main().catch(console.error);
