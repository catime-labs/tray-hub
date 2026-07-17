import { createManifest, findCollection } from './catalog.js';

const JSON_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800';

export default {
    async fetch(request, env = {}, context = {}) {
        const url = new URL(request.url);
        const cors = corsHeaders(env.ALLOWED_ORIGIN || '*');

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return json({ error: 'Method not allowed' }, 405, cors, { Allow: 'GET, HEAD, OPTIONS' });
        }

        if (url.pathname === '/' || url.pathname === '/health') {
            const payload = url.pathname === '/health'
                ? { status: 'ok' }
                : { name: 'tray-hub', version: 'v1', manifest: '/sections.json' };
            return json(payload, 200, cors);
        }

        if (url.pathname === '/sections.json' || url.pathname === '/v1/collections') {
            return json(createManifest(url.origin), 200, cors, { 'Cache-Control': JSON_CACHE_CONTROL }, request.method);
        }

        const match = url.pathname.match(/^\/v1\/assets\/([^/]+)\/(.+)$/);
        if (match) {
            try {
                return redirectAsset(url, decodeURIComponent(match[1]), decodeURIComponent(match[2]), cors);
            } catch {
                return json({ error: 'Invalid asset path' }, 400, cors);
            }
        }

        return json({ error: 'Not found' }, 404, cors);
    },
};

function redirectAsset(url, collectionKey, filename, cors) {
    const collection = findCollection(collectionKey);
    if (!collection || !collection.files.includes(filename)) {
        return json({ error: 'Asset not found' }, 404, cors);
    }

    const assetUrl = new URL(url);
    assetUrl.pathname = `/assets/${encodeURIComponent(collection.key)}/${filename.split('/').map(encodeURIComponent).join('/')}`;
    return new Response(null, {
        status: 307,
        headers: {
            Location: assetUrl.toString(),
            'Cache-Control': 'public, max-age=300',
            ...cors,
        },
    });
}

function json(payload, status, cors, extraHeaders = {}, method = 'GET') {
    const body = JSON.stringify(payload, null, 2);
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
        ...extraHeaders,
    });
    return new Response(method === 'HEAD' ? null : body, { status, headers });
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}
