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