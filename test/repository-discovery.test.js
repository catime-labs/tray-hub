import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryRecord, inspectRepository } from '../scripts/repository-discovery.mjs';

const completeTree = {
    sha: 'abc123',
    truncated: false,
    tree: [
        { type: 'blob', path: 'README.md' },
        { type: 'blob', path: 'a.webp' },
        { type: 'blob', path: 'nested/1.png' },
    ],
};

test('automatically discovers public repositories using the author folder structure', () => {
    assert.deepEqual(inspectRepository(completeTree), {
        hasReadme: true,
        hasAvatar: true,
        hasAssets: true,
        shouldCheckout: true,
    });
});

test('requires README, a root avatar, and at least one separate animation asset', () => {
    const withoutReadme = { ...completeTree, tree: completeTree.tree.filter(entry => entry.path !== 'README.md') };
    const withoutAvatar = { ...completeTree, tree: completeTree.tree.filter(entry => entry.path !== 'a.webp') };
    const withoutAssets = { ...completeTree, tree: completeTree.tree.filter(entry => entry.path === 'README.md' || entry.path === 'a.webp') };

    assert.equal(inspectRepository(withoutReadme).shouldCheckout, false);
    assert.equal(inspectRepository(withoutAvatar).shouldCheckout, false);
    assert.equal(inspectRepository(withoutAssets).shouldCheckout, false);
});

test('does not mistake the reserved root avatar for an animation', () => {
    const avatarOnly = {
        tree: [
            { type: 'blob', path: 'README.md' },
            { type: 'blob', path: 'a.png' },
        ],
    };
    const nestedAnimation = {
        tree: [
            ...avatarOnly.tree,
            { type: 'blob', path: 'nested/a.png' },
        ],
    };

    assert.equal(inspectRepository(avatarOnly).hasAssets, false);
    assert.equal(inspectRepository(nestedAnimation).shouldCheckout, true);
});

test('does not clone an unrelated truncated repository without the required structure', () => {
    assert.equal(inspectRepository({ tree: [], truncated: true }).shouldCheckout, false);
    assert.equal(inspectRepository(null).shouldCheckout, false);
});

test('records authoritative GitHub repository source metadata', () => {
    assert.deepEqual(discoveryRecord({
        name: 'artist',
        html_url: 'https://github.com/catime-labs/artist',
        default_branch: 'artwork',
    }, completeTree), {
        repository: 'https://github.com/catime-labs/artist',
        branch: 'artwork',
        commit: 'abc123',
    });
});
