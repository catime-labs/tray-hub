import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

test('serves a website-compatible manifest', async () => {
    const response = await worker.fetch(new Request('https://tray.example/sections.json'));
    const manifest = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(manifest.sections.eirna.count, 3);
    assert.deepEqual(manifest.sections.eirna.files, ['1.gif', '2.gif', '3.gif']);
    assert.equal(manifest.sections.eirna.fileVersions[0], '931193f504a9');
    assert.equal(manifest.sections.eirna.cdnBase, 'https://tray.example/assets/eirna/');
});

test('redirects registered legacy asset routes to static assets', async () => {
    const response = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/2.gif?v=abc'));

    assert.equal(response.status, 307);
    assert.equal(response.headers.get('Location'), 'https://tray.example/assets/eirna/2.gif?v=abc');
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
