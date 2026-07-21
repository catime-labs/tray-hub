import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/collections.json' with { type: 'json' };
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
    assert.match(manifest.sections.eirna.fileVersions[0], /^[a-f0-9]{12}$/);
    assert.deepEqual(manifest.sections.eirna.authorLinks, [
        { label: 'Bilibili', url: 'https://space.bilibili.com/1195508399' },
    ]);
    assert.equal(manifest.sections.eirna.authorAvatar, 'https://tray.example/avatars/eirna.webp');
    assert.equal(manifest.sections.eirna.cdnBase, 'https://tray.example/assets/eirna/');
});

test('redirects registered legacy asset routes to static assets', async () => {
    const filename = eirna.files[0];
    const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
    const response = await worker.fetch(new Request(`https://tray.example/v1/assets/eirna/${encodedFilename}?v=abc`));

    assert.equal(response.status, 307);
    assert.equal(response.headers.get('Location'), `https://tray.example/assets/eirna/${encodedFilename}?v=abc`);
});

test('rejects unknown assets', async () => {
    const response = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/missing.gif'));

    assert.equal(response.status, 404);
});

test('handles preflight and unsupported methods', async () => {
    const options = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'OPTIONS' }));
    const post = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'POST' }));

    assert.equal(options.status, 204);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
});

test('returns a client error for malformed asset paths', async () => {
    const response = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/%E0%A4%A'));
    assert.equal(response.status, 400);
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
