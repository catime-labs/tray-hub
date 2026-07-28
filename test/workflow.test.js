import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('asset sync explicitly dispatches deployment after GITHUB_TOKEN catalog pushes', async () => {
    const workflow = await readFile(new URL('../.github/workflows/sync.yml', import.meta.url), 'utf8');

    assert.match(workflow, /permissions:\s+[\s\S]*actions:\s+write/);
    assert.match(workflow, /gh workflow run deploy\.yml[^\n]*--ref main/);
    assert.match(workflow, /steps\.catalog\.outputs\.deploy == 'true'/);
});
