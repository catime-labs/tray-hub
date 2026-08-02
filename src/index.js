import { createManifest } from './catalog.js';

const JSON_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ASSET_PREFIXES = ['/assets/', '/avatars/', '/posters/', '/previews/'];

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

        if (ASSET_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) {
            return serveAsset(request, env, cors);
        }

        return json({ error: 'Not found' }, 404, cors, { method: request.method });
    },
};

async function serveAsset(request, env, cors) {
    if (!env.ASSETS?.fetch) return json({ error: 'Asset binding unavailable' }, 503, cors, { method: request.method });

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([name, value]) => headers.set(name, value));
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set(
        'Cache-Control',
        response.status >= 200 && response.status < 400 ? IMMUTABLE_CACHE_CONTROL : 'no-store',
    );
    const url = new URL(request.url);
    const downloadName = url.pathname.startsWith('/assets/')
        ? normalizeDownloadName(url.searchParams.get('download'))
        : '';
    if (downloadName && response.status >= 200 && response.status < 400) {
        headers.set('Content-Disposition', attachmentDisposition(downloadName));
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function normalizeDownloadName(value) {
    if (!value) return '';
    const normalized = value
        .normalize('NFC')
        .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '-')
        .replace(/[. ]+$/g, '')
        .trim();
    return Array.from(normalized).slice(0, 180).join('');
}

function attachmentDisposition(filename) {
    const fallback = filename
        .replace(/[^\x20-\x7e]+/g, '_')
        .replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(filename)
        .replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

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
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Disposition, Content-Length, Content-Range',
    };
}
