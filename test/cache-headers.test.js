import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('fingerprinted image routes use long-lived immutable caching', async () => {
    const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');

    for (const route of ['/assets/*', '/avatars/*', '/posters/*', '/previews/*']) {
        const start = headers.indexOf(route);
        assert.notEqual(start, -1, `${route} is missing`);
        const block = headers.slice(start, headers.indexOf('\n\n', start) < 0 ? undefined : headers.indexOf('\n\n', start));
        assert.match(block, /Cache-Control: public, max-age=31536000, immutable/);
        assert.match(block, /Access-Control-Allow-Origin: \*/);
    }
});
