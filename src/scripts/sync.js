/**
 * index-products-from-bc.mjs
 * Indexes products directly from BigCommerce into your new Meilisearch instance.
 * Re-run this script whenever you update products in BigCommerce.
 */
import dotenv from 'dotenv';
import { meiliFetch } from '../services/meilisearch.js';
import { bcGetAll } from '../services/bigcommerce.js';
import { log as fileLog, logSpacer } from '../services/logger.js';

let currentContext = 'CLI-SYNC';

const console = {
    log: (message, ...args) => {
        let formatted = message;
        if (args.length > 0) {
            formatted += ' ' + args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        }
        fileLog(formatted, currentContext);
    },
    error: (message, ...args) => {
        let formatted = message;
        if (args.length > 0) {
            formatted += ' ' + args.map(arg => arg instanceof Error ? arg.stack || arg.message : (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
        }
        fileLog(formatted, currentContext);
    }
};

dotenv.config({ path: ['.env.local', '.env'] });

const BC_STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const BC_ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const MEILI_HOST = process.env.MEILISEARCH_URL || process.env.NEXT_PUBLIC_MEILISEARCH_URL;
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY;
const INDEX_NAME = 'product_index';
const TEMP_INDEX_NAME = 'product_index_tmp';

if (!BC_STORE_HASH || !BC_ACCESS_TOKEN || !MEILI_HOST || !MEILI_MASTER_KEY) {
    console.error('❌ Missing required environment variables in env files:');
    console.error('   BIGCOMMERCE_STORE_HASH:', BC_STORE_HASH ? '✅' : '❌ MISSING');
    console.error('   BIGCOMMERCE_ACCESS_TOKEN:', BC_ACCESS_TOKEN ? '✅' : '❌ MISSING');
    console.error('   MEILISEARCH_URL / NEXT_PUBLIC_MEILISEARCH_URL:', MEILI_HOST ? '✅' : '❌ MISSING');
    console.error('   MEILI_MASTER_KEY:', MEILI_MASTER_KEY ? '✅' : '❌ MISSING');
    process.exit(1);
}

async function waitForTask(taskUid) {
    while (true) {
        const task = await meiliFetch(`/tasks/${taskUid}`);
        if (task.status === 'succeeded') return task;
        if (task.status === 'failed') {
            throw new Error(`Meilisearch task ${taskUid} failed: ${JSON.stringify(task.error)}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }
}

// Build category tree mappings
function buildCategoryPaths(categories) {
    const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

    const getPath = (catId) => {
        const path = [];
        let current = catMap[catId];
        while (current) {
            path.unshift(current.name);
            current = current.parent_id ? catMap[current.parent_id] : null;
        }
        return path;
    };

    const productCategoryPaths = {};
    for (const cat of categories) {
        productCategoryPaths[cat.id] = getPath(cat.id);
    }
    return productCategoryPaths;
}

// Transform BC product to Optimum7 Meilisearch document schema
function transformProduct(product, brandMap, catPaths) {
    const variants = product.variants || [];

    // Extract images
    const thumbnailImage = product.images?.find(img => img.is_thumbnail) || product.images?.[0];
    const primaryImageTiny = product.images?.find(img => img.url_tiny)?.url_tiny || thumbnailImage?.url_thumbnail || '';
    const primaryImageThumbnail = thumbnailImage?.url_thumbnail || thumbnailImage?.url_standard || '';

    // Extract prices across variants with correct fallbacks
    const allPrices = variants.map(v => parseFloat(v.price || product.price || 0)).filter(p => p > 0);
    const uniquePrices = [...new Set(allPrices)];

    const allSalePrices = variants.map(v => parseFloat(v.sale_price || v.price || product.sale_price || product.price || 0)).filter(p => p > 0);
    const uniqueSalePrices = [...new Set(allSalePrices)];

    const allRetailPrices = variants.map(v => parseFloat(v.retail_price || v.price || product.retail_price || product.price || 0)).filter(p => p > 0);
    const uniqueRetailPrices = [...new Set(allRetailPrices)];

    // Extract categories breadcrumbs
    const categoryIds = product.categories || [];
    const lvl0 = [];
    const lvl1 = [];
    const lvl2 = [];
    const lvl3 = [];

    categoryIds.forEach((catId) => {
        const path = catPaths[catId];
        if (path) {
            if (path[0]) lvl0.push(path[0]);
            if (path[1]) lvl1.push(`${path[0]} > ${path[1]}`);
            if (path[2]) lvl2.push(`${path[0]} > ${path[1]} > ${path[2]}`);
            if (path[3]) lvl3.push(`${path[0]} > ${path[1]} > ${path[2]} > ${path[3]}`);
        }
    });

    // Extract options data (like color, thickness, firmness, size, etc.)
    const optionFieldMap = {
        'color': 'color',
        'thickness': 'thickness',
        'firmness ild': 'firmness_ild',
        'firmness (ild)': 'firmness_ild',
        'sheet size': 'sheet_size',
        'foam type': 'foam_type',
        'foam color': 'foam_color',
        'support layer firmness': 'support_layer_firmness'
    };

    const extractedOptions = {};
    if (product.options && Array.isArray(product.options)) {
        product.options.forEach(opt => {
            const displayName = opt.display_name?.toLowerCase().trim();
            const targetField = optionFieldMap[displayName];
            if (targetField && opt.option_values && Array.isArray(opt.option_values)) {
                const values = opt.option_values.map(val => {
                    const label = val.label || '';
                    if (targetField === 'color') {
                        if (val.value_data && Array.isArray(val.value_data.colors) && val.value_data.colors[0]) {
                            return `${label};${val.value_data.colors[0]}`;
                        } else if (val.value_data && val.value_data.image_url) {
                            return `${label};${val.value_data.image_url}`;
                        }
                    }
                    return label;
                }).filter(Boolean);

                if (values.length > 0) {
                    if (extractedOptions[targetField]) {
                        extractedOptions[targetField] = [...new Set([...extractedOptions[targetField], ...values])];
                    } else {
                        extractedOptions[targetField] = values;
                    }
                }
            }
        });
    }

    // Base document fields matching Optimum7 schema
    const doc = {
        id: product.id,
        bigcommerce_id: product.id,
        product_sku: product.sku || '',
        product_name: product.name || '',
        product_brand_id: product.brand_id || null,
        product_brand: brandMap[product.brand_id] || null,
        inventory_tracking: product.inventory_tracking || 'none',
        inventory_level: product.inventory_level || 0,
        created_at: product.date_created,
        updated_at: product.date_modified,
        url: product.custom_url?.url || '',
        price: parseFloat(product.price || 0),
        sale_price: parseFloat(product.sale_price || 0),
        retail_price: parseFloat(product.retail_price || 0),
        map_price: parseFloat(product.map_price || 0),
        calculated_price: parseFloat(product.calculated_price || product.price || 0),
        is_visible: product.is_visible ?? true,
        availability: product.availability || 'available',
        is_featured: product.is_featured ? 1 : 0,
        sort_order: product.sort_order || 0,
        view_count: product.view_count || 0,
        search_keywords: product.search_keywords || '',
        upc: product.upc || '',
        gtin: product.gtin || '',
        mpn: product.mpn || '',
        reviews_rating_sum: product.reviews_rating_sum || 0,
        reviews_count: product.reviews_count || 0,
        total_sold: product.total_sold || 0,
        date_created: product.date_created,
        date_modified: product.date_modified,
        primary_image_thumbnail: primaryImageThumbnail,
        primary_image_tiny: primaryImageTiny,
        primary_image_alt: thumbnailImage?.description || null,
        category_id_store: categoryIds,
        prices: uniquePrices.length > 0 ? uniquePrices : [parseFloat(product.price || 0)],
        sale_prices: uniqueSalePrices.length > 0 ? uniqueSalePrices : [parseFloat(product.price || 0)],
        retail_prices: uniqueRetailPrices.length > 0 ? uniqueRetailPrices : [parseFloat(product.price || 0)],
        saving: 0,
        variants: variants.map(v => ({
            sku: v.sku,
            id: v.id,
            inventory_level: v.inventory_level || 0,
            price: String(parseFloat(v.price || product.price || 0).toFixed(2)),
            sale_price: String(parseFloat(v.sale_price || v.price || product.sale_price || product.price || 0).toFixed(2)),
            retail_price: String(parseFloat(v.retail_price || v.price || product.retail_price || product.price || 0).toFixed(2)),
            option_values: v.option_values?.map(o => ({
                id: o.id,
                label: o.label,
                option_id: o.option_id,
                option_display_name: o.option_display_name
            })) || [],
            image_url: v.image_url || ''
        })),
        "categories.lvl0": [...new Set(lvl0)],
        "categories.lvl1": [...new Set(lvl1)],
        "categories.lvl2": [...new Set(lvl2)],
        "categories.lvl3": [...new Set(lvl3)],
        ...extractedOptions
    };

    // Match Optimum7's exact custom fields normalizer rules
    if (product.custom_fields && Array.isArray(product.custom_fields)) {
        product.custom_fields.forEach(cf => {
            const key = cf.name.trim().toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]+/g, '')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '');

            if (key) {
                // Prevent custom fields from overwriting option values if defined
                if (doc[key] && Array.isArray(doc[key]) && doc[key].length > 0) {
                    return;
                }

                if (key === 'application') {
                    doc[key] = cf.value.split(',').map(v => v.trim());
                } else {
                    doc[key] = cf.value;
                }
            }
        });
    }

    return doc;
}

async function configureIndex() {
    console.log('⚙️ Creating and configuring Meilisearch index settings...');

    // 1. Ensure the live index exists (required for swapping on first run)
    try {
        await meiliFetch(`/indexes/${INDEX_NAME}`);
        console.log(`ℹ️ Live index '${INDEX_NAME}' exists.`);
    } catch (error) {
        console.log(`ℹ️ Live index '${INDEX_NAME}' does not exist yet. Creating it...`);
        try {
            const createLiveTask = await meiliFetch('/indexes', 'POST', {
                uid: INDEX_NAME,
                primaryKey: 'id'
            });
            if (createLiveTask.taskUid) {
                await waitForTask(createLiveTask.taskUid);
                console.log('✅ Live index pre-created successfully.');
            }
        } catch (err) {
            if (!err.message.includes('index_already_exists')) {
                throw err;
            }
        }
    }

    // 2. Delete the temporary index if it exists to start with a clean slate
    try {
        const deleteTmpTask = await meiliFetch(`/indexes/${TEMP_INDEX_NAME}`, 'DELETE');
        if (deleteTmpTask && deleteTmpTask.taskUid) {
            await waitForTask(deleteTmpTask.taskUid);
            console.log('🗑️ Leftover temporary index deleted.');
        }
    } catch (error) {
        // Safe to ignore if it doesn't exist
    }

    // 3. Create the temporary index with 'id' primary key
    const createIndexTask = await meiliFetch('/indexes', 'POST', {
        uid: TEMP_INDEX_NAME,
        primaryKey: 'id'
    });
    if (createIndexTask && createIndexTask.taskUid) {
        await waitForTask(createIndexTask.taskUid);
        console.log('✅ Temporary index created.');
    }

    // 4. Configure settings on the temporary index
    const settingsTask = await meiliFetch(`/indexes/${TEMP_INDEX_NAME}/settings`, 'PATCH', {
        filterableAttributes: [
            'adjustment_amount', 'api_cover_type', 'application', 'available_lengths',
            'back_fabric', 'back_fabric_color', 'base_layer_support', 'brandtype',
            'bulk_order_information', 'calculated_price', 'categories', 'categories.lvl0',
            'categories.lvl1', 'categories.lvl2', 'categories.lvl3', 'category_id_store',
            'certifications', 'color', 'colors_pair', 'colors_present', 'cost_custom_covers',
            'cover', 'custom_product', 'dacron_option', 'dims', 'extended_delivery_notice',
            'fabric_care_instructions', 'fabric_type', 'fiber', 'firmness_ild',
            'firmness_preference', 'foam', 'foam_color', 'foam_quality', 'foam_type',
            'front_fabric', 'front_fabric_color', 'gourp_link', 'group', 'ild_firmness',
            'inventory_level', 'is_excluded_from_related_products', 'is_merchant_center_product',
            'is_visible', 'left_firmness', 'material_pair', 'material_present', 'noindex',
            'of_covers', 'pattern', 'price', 'prices', 'primary_color', 'product_brand_id',
            'product_hash', 'product_sku', 'product_weight_per_roll_50_yards',
            'product_weight_per_yard', 'retail_prices', 'right_firmness', 'rubber_texture',
            'sale_price', 'sale_prices', 'secondary_color', 'shape', 'sheet_size',
            'sheet_size_inches', 'shipperhq_shipping_group', 'shipping_details',
            'shipping_groups', 'shipping_returns', 'split_firmness', 'support_layer_firmness',
            'thickness', 'thickness_firmness', 'thickness_inches', 'thread_count',
            'width_in_inchescm'
        ],
        sortableAttributes: ['product_name', 'price', 'sort_order', 'date_modified'],
        searchableAttributes: ['product_name', 'name', 'product_sku', 'sku', 'search_keywords'],
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness']
    });

    if (settingsTask.taskUid) {
        await waitForTask(settingsTask.taskUid);
        console.log('✅ Temporary index settings configured.');
    }
}

async function main(context = 'CLI-SYNC') {
    currentContext = context;
    console.log('🚀 Starting BigCommerce Product Indexer ...');

    try {
        // 1. Configure Meilisearch settings on temporary index
        await configureIndex();

        // 2. Fetch Category and Brands mappings concurrently from BigCommerce
        console.log('🏷️ Fetching brand and category details from BigCommerce...');
        const [brands, categories] = await Promise.all([
            bcGetAll('/catalog/brands'),
            bcGetAll('/catalog/categories')
        ]);

        const brandMap = Object.fromEntries(brands.map(b => [b.id, b.name]));
        const catPaths = buildCategoryPaths(categories);
        console.log(`   Fetched ${brands.length} brands and ${categories.length} categories.`);

        // 3. Fetch all products from BigCommerce (including variants, images, custom_fields, options)
        console.log('📦 Downloading all products from BigCommerce catalog (this may take a minute)...');
        const products = await bcGetAll('/catalog/products', {
            include: 'images,variants,custom_fields,options'
        });
        console.log(`   Successfully fetched ${products.length} products.`);

        // 4. Transform into Meilisearch documents (filtering out invisible/hidden products)
        console.log('🔄 Filtering and formatting products into Meilisearch schema...');
        const visibleProducts = products.filter(p => p.is_visible === true);
        console.log(`   Filtered out ${products.length - visibleProducts.length} hidden products. Indexing ${visibleProducts.length} visible products.`);
        const documents = visibleProducts.map(p => transformProduct(p, brandMap, catPaths));

        // 5. Upload to Meilisearch temporary index in batches of 500
        console.log('⬆️ Uploading documents to temporary index...');
        const batchSize = 500;
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            console.log(`   Uploading batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(documents.length / batchSize)} (${batch.length} products)...`);

            const task = await meiliFetch(`/indexes/${TEMP_INDEX_NAME}/documents`, 'POST', batch);
            if (task.taskUid) {
                await waitForTask(task.taskUid);
            }
        }

        // 6. Swap indexes atomically
        console.log('🔄 Swapping temporary index with live index...');
        const swapTask = await meiliFetch('/swap-indexes', 'POST', [
            { indexes: [INDEX_NAME, TEMP_INDEX_NAME] }
        ]);
        if (swapTask.taskUid) {
            await waitForTask(swapTask.taskUid);
        }
        console.log('✅ Index swapped successfully. Search is now live!');

    } catch (error) {
        console.error('❌ Reindexing failed midway:', error.message);
        throw error;
    } finally {
        // Clean up the temporary index (which now has the old index's data or incomplete state)
        console.log('🧹 Cleaning up temporary index...');
        try {
            const cleanTask = await meiliFetch(`/indexes/${TEMP_INDEX_NAME}`, 'DELETE');
            if (cleanTask.taskUid) {
                await waitForTask(cleanTask.taskUid);
            }
            console.log('✅ Cleanup completed successfully.');
        } catch (cleanError) {
            // Ignore if it was not created
        }

        // Verify stats on the live index
        try {
            const stats = await meiliFetch(`/indexes/${INDEX_NAME}/stats`);
            console.log(`📊 Active documents indexed in Meilisearch: ${stats.numberOfDocuments}`);
        } catch (err) {
            // Index might not exist yet if the first-ever run failed
        }
        logSpacer();
    }
}

if (process.argv[1] && (process.argv[1].endsWith('sync.js') || process.argv[1].includes('sync'))) {
    main().catch(error => {
        console.error('❌ Fatal Indexer Error:', error);
        process.exit(1);
    });
}
export { transformProduct, buildCategoryPaths, main }; // For imports
