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
    assert.equal(manifest.sections.eirna.cdnBase, 'https://tray.example/v1/assets/eirna/');
});

test('proxies only registered assets', async () => {
    let requestedUrl;
    const env = {
        GITHUB_TOKEN: 'test-token',
        UPSTREAM_FETCH: async (url, init) => {
            requestedUrl = url;
            assert.equal(init.headers.Authorization, 'Bearer test-token');
            return new Response('gif-data', { headers: { 'Content-Type': 'image/gif' } });
        },
    };
    const response = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/2.gif'), env);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/gif');
    assert.equal(await response.text(), 'gif-data');
    assert.equal(requestedUrl, 'https://api.github.com/repos/catime-labs/eirna/contents/2.gif?ref=main');
});

test('rejects unknown assets without contacting GitHub', async () => {
    const env = { UPSTREAM_FETCH: () => assert.fail('upstream fetch must not run') };
    const response = await worker.fetch(new Request('https://tray.example/v1/assets/eirna/missing.gif'), env);

    assert.equal(response.status, 404);
});

test('handles preflight and unsupported methods', async () => {
    const options = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'OPTIONS' }));
    const post = await worker.fetch(new Request('https://tray.example/sections.json', { method: 'POST' }));

    assert.equal(options.status, 204);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
});
