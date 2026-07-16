import { createManifest, findCollection } from './catalog.js';

const JSON_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';

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
            return serveAsset(request, env, decodeURIComponent(match[1]), decodeURIComponent(match[2]), cors);
        }

        return json({ error: 'Not found' }, 404, cors);
    },
};

async function serveAsset(request, env, collectionKey, filename, cors) {
    const collection = findCollection(collectionKey);
    if (!collection || !collection.files.includes(filename)) {
        return json({ error: 'Asset not found' }, 404, cors);
    }

    if (!env.ASSETS) return json({ error: 'Static assets are not configured' }, 503, cors);

    const assetUrl = new URL(request.url);
    assetUrl.pathname = `/assets/${encodeURIComponent(collection.key)}/${filename.split('/').map(encodeURIComponent).join('/')}`;
    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
    if (!assetResponse.ok) return json({ error: 'Asset unavailable' }, 502, cors);

    const cacheSeconds = positiveInteger(env.ASSET_CACHE_SECONDS, 86400);
    const headers = new Headers(assetResponse.headers);
    headers.set('Content-Type', contentTypeFor(filename));
    headers.set('Cache-Control', `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`);
    headers.set('X-Content-Type-Options', 'nosniff');
    Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
    const response = new Response(assetResponse.body, { status: 200, headers });

    return request.method === 'HEAD' ? new Response(null, response) : response;
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

function positiveInteger(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function contentTypeFor(filename) {
    const extension = filename.split('.').at(-1)?.toLowerCase();
    return {
        gif: 'image/gif',
        webp: 'image/webp',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        avif: 'image/avif',
    }[extension] || 'application/octet-stream';
}
