import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCollectionSource } from '../scripts/catalog-metadata.mjs';

test('prefers authoritative discovery metadata and preserves non-main branches', () => {
    const source = resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        metadata: { repository: 'https://example.com/wrong', branch: 'wrong' },
        discovered: {
            repository: 'https://github.com/catime-labs/artist',
            branch: 'artwork',
        },
    });

    assert.deepEqual(source, {
        repository: 'https://github.com/catime-labs/artist',
        branch: 'artwork',
    });
});

test('rejects unsafe repository URLs and invalid branches', () => {
    assert.throws(() => resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        metadata: { repository: 'file:///tmp/assets' },
    }), /public HTTPS URL/);
    assert.throws(() => resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        metadata: { branch: '../outside' },
    }), /invalid Git branch/);
    assert.throws(() => resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        metadata: { branch: 'feature/.hidden' },
    }), /invalid Git branch/);
});
