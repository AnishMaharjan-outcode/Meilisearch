import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const BC_STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const BC_ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;

if (!BC_STORE_HASH || !BC_ACCESS_TOKEN) {
    console.error('❌ Missing BigCommerce credentials in env files.');
}

const bcHeaders = {
    'X-Auth-Token': BC_ACCESS_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

// Simple in-memory cache for brands and categories
let cachedBrands = null;
let cachedBrandsExpiry = 0;

let cachedCategories = null;
let cachedCategoriesExpiry = 0;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function bcGet(path, retries = 3, delay = 1000) {
    try {
        const res = await fetch(`https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3${path}`, {
            headers: bcHeaders
        });
        if (!res.ok) {
            if (res.status === 429 && retries > 0) {
                const retryAfter = parseInt(res.headers.get('X-Retry-After') || '5', 10);
                console.warn(`⚠️ BigCommerce rate limit hit. Retrying in ${retryAfter}s...`);
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                return bcGet(path, retries - 1, delay * 2);
            }
            throw new Error(`BigCommerce API error ${res.status} on ${path}`);
        }
        return res.json();
    } catch (error) {
        if (retries > 0) {
            console.warn(`⚠️ Connection error (${error.message}) on ${path}. Retrying in ${delay / 1000}s... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, delay));
            return bcGet(path, retries - 1, delay * 2);
        }
        throw error;
    }
}

export async function bcGetAll(path, queryParams = {}) {
    const results = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const query = new URLSearchParams({ ...queryParams, page, limit: 250 }).toString();
        const response = await bcGet(`${path}?${query}`);
        results.push(...(response.data || []));

        const pagination = response.meta?.pagination;
        if (pagination && pagination.current_page < pagination.total_pages) {
            page++;
        } else {
            hasMore = false;
        }
    }
    return results;
}

export async function fetchProduct(productId) {
    const response = await bcGet(`/catalog/products/${productId}?include=images,variants,custom_fields,options`);
    return response.data;
}

export async function fetchBrands() {
    const now = Date.now();
    if (cachedBrands && now < cachedBrandsExpiry) {
        return cachedBrands;
    }
    const brands = await bcGetAll('/catalog/brands');
    cachedBrands = brands;
    cachedBrandsExpiry = now + CACHE_TTL;
    return brands;
}

export async function fetchCategories() {
    const now = Date.now();
    if (cachedCategories && now < cachedCategoriesExpiry) {
        return cachedCategories;
    }
    const categories = await bcGetAll('/catalog/categories');
    cachedCategories = categories;
    cachedCategoriesExpiry = now + CACHE_TTL;
    return categories;
}
