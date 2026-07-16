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
            return serveAsset(request, env, context, decodeURIComponent(match[1]), decodeURIComponent(match[2]), cors);
        }

        return json({ error: 'Not found' }, 404, cors);
    },
};

async function serveAsset(request, env, context, collectionKey, filename, cors) {
    const collection = findCollection(collectionKey);
    if (!collection || !collection.files.includes(filename)) {
        return json({ error: 'Asset not found' }, 404, cors);
    }

    const cache = typeof caches === 'undefined' ? null : caches.default;
    const cacheKey = new Request(request.url, { method: 'GET' });
    if (cache) {
        const cached = await cache.match(cacheKey);
        if (cached) return withCors(cached, cors, request.method);
    }

    const repository = new URL(collection.repository);
    const [owner, repo] = repository.pathname.split('/').filter(Boolean);
    const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
    const upstreamUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(collection.branch)}`;
    const upstreamFetch = env.UPSTREAM_FETCH || fetch;
    const upstreamHeaders = {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'catime-labs/tray-hub',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (env.GITHUB_TOKEN) upstreamHeaders.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

    let upstream;
    try {
        upstream = await upstreamFetch(upstreamUrl, { headers: upstreamHeaders });
    } catch {
        return json({ error: 'Upstream asset unavailable' }, 502, cors);
    }

    if (!upstream.ok) {
        return json({ error: 'Upstream asset unavailable' }, 502, cors);
    }

    const cacheSeconds = positiveInteger(env.ASSET_CACHE_SECONDS, 86400);
    const headers = new Headers({
        'Content-Type': upstream.headers.get('Content-Type') || 'image/gif',
        'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
        'X-Content-Type-Options': 'nosniff',
        ...cors,
    });
    const response = new Response(upstream.body, { status: 200, headers });

    if (cache && context.waitUntil) context.waitUntil(cache.put(cacheKey, response.clone()));
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

function withCors(response, cors, method) {
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
    return new Response(method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

function positiveInteger(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}
