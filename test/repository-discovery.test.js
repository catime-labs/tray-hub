import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TRAY_REPOSITORY_TOPIC,
    discoveryRecord,
    inspectRepository,
    isLocalRepositoryOptedIn,
    isRemoteRepositoryOptedIn,
} from '../scripts/repository-discovery.mjs';

const assetTree = {
    sha: 'abc123',
    truncated: false,
    tree: [{ type: 'blob', path: 'nested/1.png' }],
};

test('requires explicit opt-in before discovering image repositories', () => {
    const unrelated = inspectRepository({ name: 'website', topics: [] }, assetTree);
    const known = inspectRepository({ name: 'eirna', topics: [] }, assetTree, new Set(['eirna']));
    const topic = inspectRepository({ name: 'new-art', topics: [TRAY_REPOSITORY_TOPIC] }, assetTree);
    const marker = inspectRepository({ name: 'marked', topics: [] }, {
        ...assetTree,
        tree: [...assetTree.tree, { type: 'blob', path: 'tray.json' }],
    });

    assert.equal(unrelated.shouldCheckout, false);
    assert.equal(known.shouldCheckout, true);
    assert.equal(topic.shouldCheckout, true);
    assert.equal(marker.shouldCheckout, true);
});

test('supports marker checks without scanning an unrelated repository tree', () => {
    const repository = { name: 'marked', topics: [] };
    assert.equal(isRemoteRepositoryOptedIn(repository, new Set(), false), false);
    assert.equal(isRemoteRepositoryOptedIn(repository, new Set(), true), true);
    assert.equal(inspectRepository(repository, assetTree, new Set(), { hasMarker: true }).shouldCheckout, true);
});

test('keeps opted-in truncated trees for validation after checkout', () => {
    const inspection = inspectRepository(
        { name: 'large', topics: [TRAY_REPOSITORY_TOPIC] },
        { tree: [], truncated: true },
    );
    assert.equal(inspection.shouldCheckout, true);
});

test('records authoritative GitHub repository source metadata', () => {
    assert.deepEqual(discoveryRecord({
        name: 'artist',
        html_url: 'https://github.com/catime-labs/artist',
        default_branch: 'artwork',
    }, assetTree), {
        repository: 'https://github.com/catime-labs/artist',
        branch: 'artwork',
        commit: 'abc123',
    });
});

test('uses the same explicit opt-in boundary for local sibling repositories', () => {
    const options = {
        knownCollections: new Map([['known', {}]]),
        discoveredRepositories: { discovered: {} },
        hasMarker: false,
    };
    assert.equal(isLocalRepositoryOptedIn('known', options), true);
    assert.equal(isLocalRepositoryOptedIn('discovered', options), true);
    assert.equal(isLocalRepositoryOptedIn('unrelated', options), false);
    assert.equal(isLocalRepositoryOptedIn('marked', { ...options, hasMarker: true }), true);
});
