import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCollectionSource } from '../scripts/catalog-metadata.mjs';

test('prefers authoritative discovery metadata and preserves non-main branches', () => {
    const source = resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        previous: { repository: 'https://example.com/old', branch: 'old' },
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
        previous: { repository: 'file:///tmp/assets' },
    }), /public HTTPS URL/);
    assert.throws(() => resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        previous: { branch: '../outside' },
    }), /invalid Git branch/);
    assert.throws(() => resolveCollectionSource({
        name: 'artist',
        organization: 'catime-labs',
        previous: { branch: 'feature/.hidden' },
    }), /invalid Git branch/);
});
