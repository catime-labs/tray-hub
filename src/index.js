import { createManifest } from './catalog.js';

const JSON_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800';

export default {
    async fetch(request, env = {}, context = {}) {
        const url = new URL(request.url);
        const cors = corsHeaders(env.ALLOWED_ORIGIN || '*');

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return json({ error: 'Method not allowed' }, 405, cors, {
                method: request.method,
                headers: { Allow: 'GET, HEAD, OPTIONS' },
            });
        }

        if (url.pathname === '/' || url.pathname === '/health') {
            const payload = url.pathname === '/health'
                ? { status: 'ok' }
                : { name: 'tray-hub', version: 'v1', manifest: '/sections.json' };
            return json(payload, 200, cors, { method: request.method });
        }

        if (url.pathname === '/sections.json') {
            return json(createManifest(url.origin), 200, cors, {
                method: request.method,
                headers: { 'Cache-Control': JSON_CACHE_CONTROL },
            });
        }

        return json({ error: 'Not found' }, 404, cors, { method: request.method });
    },
};

function json(payload, status, cors, { headers: extraHeaders = {}, method = 'GET' } = {}) {
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
