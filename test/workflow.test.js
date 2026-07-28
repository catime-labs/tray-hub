import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('asset sync requests a Cloudflare Git rebuild when the public catalog is stale', async () => {
    const workflow = await readFile(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8');

    assert.match(workflow, /git commit --allow-empty -m "chore: redeploy tray assets"/);
    assert.match(workflow, /git push origin HEAD:main/);
    assert.doesNotMatch(workflow, /gh workflow run/);
});
