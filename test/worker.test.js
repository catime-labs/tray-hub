import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/collections.json' with { type: 'json' };
import { resolvePublicUrl } from '../src/catalog.js';
import worker from '../src/index.js';

const eirna = catalog.collections.find(collection => collection.key === 'eirna');

test('serves a website-compatible manifest', async () => {
    const response = await worker.fetch(new Request('https://tray.example/sections.json'));
    const manifest = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match(response.headers.get('Cache-Control'), /stale-while-revalidate=86400/);
    assert.ok(eirna?.files.length > 0);
    assert.equal(manifest.sections.eirna.count, eirna.files.length);
    assert.deepEqual(manifest.sections.eirna.files, eirna.files);
    assert.equal('author' in manifest.sections.eirna, false);
    assert.equal('title' in manifest.sections.eirna, false);
    assert.match(manifest.sections.eirna.fileVersions[0], /^[a-f0-9]{12}$/);
    assert.deepEqual(
        manifest.sections.eirna.posterFiles,
        eirna.files.map(filename => `${filename}.webp`),
    );
    assert.deepEqual(
        manifest.sections.eirna.previewFiles,
        eirna.files.map(filename => `${filename}.webp`),
    );
    assert.match(manifest.sections.eirna.posterVersions[0], /^[a-f0-9]{12}$/);
    assert.match(manifest.sections.eirna.previewVersions[0], /^[a-f0-9]{12}$/);
    assert.deepEqual(manifest.sections.eirna.authorLinks, [
        { label: 'Bilibili', url: 'https://space.bilibili.com/1195508399' },
    ]);
    assert.match(
        manifest.sections.eirna.authorAvatar,
        /^https:\/\/tray\.example\/avatars\/eirna\/a\.webp\?v=[a-f0-9]{12}$/,
    );
    assert.equal(manifest.sections.eirna.cdnBase, 'https://tray.example/assets/eirna/');
    assert.equal(manifest.sections.eirna.posterCdnBase, 'https://tray.example/posters/eirna/');
    assert.equal(manifest.sections.eirna.previewCdnBase, 'https://tray.example/previews/eirna/');
});

test('does not expose the removed v1 compatibility routes', async () => {
    const manifestAlias = await worker.fetch(new Request('https://tray.example/v1/collections'));
    const assetAlias = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/1.gif'));

    assert.equal(manifestAlias.status, 404);
    assert.equal(assetAlias.status, 404);
});

test('handles preflight and unsupported methods', async () => {
    const options = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'OPTIONS' }));
    const post = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'POST' }));

    assert.equal(options.status, 204);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
});

test('returns empty bodies for HEAD requests on every JSON route', async () => {
    for (const path of ['/health', '/sections.json', '/missing']) {
        const response = await worker.fetch(new Request(`https://tray.example${path}`, { method: 'HEAD' }));
        assert.equal(await response.text(), '');
    }
});

test('only publishes HTTP or HTTPS profile and avatar URLs', () => {
    assert.equal(resolvePublicUrl('javascript:alert(1)'), '');
    assert.equal(resolvePublicUrl('/avatars/eirna/a.webp', 'https://tray.example'), 'https://tray.example/avatars/eirna/a.webp');
    assert.equal(resolvePublicUrl('https://example.com/profile'), 'https://example.com/profile');
});

test('allows direct and third-party access to public routes', async () => {
    const env = { ALLOWED_ORIGIN: '*' };
    const direct = await worker.fetch(new Request('https://tray.example/sections.json'), env);
    const thirdParty = await worker.fetch(new Request('https://tray.example/sections.json', {
        headers: { Origin: 'https://example.com' },
    }), env);
    const health = await worker.fetch(new Request('https://tray.example/health'), env);

    assert.equal(direct.status, 200);
    assert.equal(thirdParty.status, 200);
    assert.equal(health.status, 200);
});

test('serves image bindings with immutable caching while preserving asset responses', async () => {
    const requests = [];
    const env = {
        ALLOWED_ORIGIN: '*',
        ASSETS: {
            fetch: async request => {
                requests.push(request);
                if (new URL(request.url).pathname.endsWith('/missing.webp')) {
                    return new Response('missing', { status: 404 });
                }
                return new Response('preview-bytes', {
                    status: 206,
                    headers: {
                        'Content-Type': 'image/webp',
                        'Content-Range': 'bytes 0-12/13',
                    },
                });
            },
        },
    };
    const response = await worker.fetch(new Request('https://tray.example/previews/eirna/1.gif.webp', {
        headers: { Range: 'bytes=0-12' },
    }), env);
    const missing = await worker.fetch(new Request('https://tray.example/posters/eirna/missing.webp'), env);

    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'preview-bytes');
    assert.equal(requests[0].headers.get('Range'), 'bytes=0-12');
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-12/13');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('Cache-Control'), 'no-store');
});
