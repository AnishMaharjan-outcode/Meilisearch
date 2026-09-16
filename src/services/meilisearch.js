export async function meiliFetch(path, method = 'GET', body = null) {
    const rawHost = process.env.MEILISEARCH_URL || process.env.NEXT_PUBLIC_MEILISEARCH_URL || '';
    const host = rawHost.replace(/\/+$/, '');
    const masterKey = process.env.MEILI_MASTER_KEY;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const res = await fetch(`${host}${cleanPath}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${masterKey}`
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Meilisearch API error ${res.status}: ${errText}`);
    }

    return res.json();
}

export async function listKeys() {
    const data = await meiliFetch('/keys');
    return data.results || [];
}

export async function createSearchOnlyKey(description) {
    return meiliFetch('/keys', 'POST', {
        description,
        actions: ['search'],
        indexes: ['*'],
        expiresAt: null
    });
}

export async function getOrCreateSearchOnlyKey() {
    const description = 'Search-only key - all indexes';

    // Check if a key with this exact description already exists
    const existingKeys = await listKeys();
    const found = existingKeys.find(k => k.description === description);

    if (found) {
        return { key: found, created: false };
    }

    const newKey = await createSearchOnlyKey(description);
    return { key: newKey, created: true };
}