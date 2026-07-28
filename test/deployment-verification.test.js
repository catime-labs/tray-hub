import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/collections.json' with { type: 'json' };
import assetLock from '../data/assets-lock.json' with { type: 'json' };
import { assertPublishedAsset, selectFormatSamples } from '../scripts/asset-signature.mjs';
import { assertManifestMatchesCatalog } from '../scripts/deployment-catalog.mjs';
import { createManifest } from '../src/catalog.js';

test('validates every supported published image signature and MIME type', () => {
    assert.doesNotThrow(() => assertPublishedAsset('1.gif', 'image/gif', Buffer.from('GIF89a')));
    assert.doesNotThrow(() => assertPublishedAsset(
        '2.png',
        'image/png',
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ));
    assert.doesNotThrow(() => assertPublishedAsset(
        '3.webp',
        'image/webp',
        Buffer.from('RIFF0000WEBP'),
    ));
    assert.doesNotThrow(() => assertPublishedAsset('4.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff])));
    assert.throws(() => assertPublishedAsset('bad.png', 'image/gif', Buffer.from('GIF89a')), /expected image\/png/);
});

test('selects one deployment sample for each published format', () => {
    assert.deepEqual(selectFormatSamples(['1.gif', '2.gif', 'nested/3.png', '4.webp']), [
        { filename: '1.gif', index: 0 },
        { filename: 'nested/3.png', index: 2 },
        { filename: '4.webp', index: 3 },
    ]);
});

test('detects a deployment that claims success while an author is missing', () => {
    const manifest = createManifest('https://tray.example');
    assert.doesNotThrow(() => assertManifestMatchesCatalog({
        manifest,
        catalog,
        assetLock,
        baseUrl: 'https://tray.example',
    }));

    const stale = structuredClone(manifest);
    delete stale.sections.YM722;
    assert.throws(() => assertManifestMatchesCatalog({
        manifest: stale,
        catalog,
        assetLock,
        baseUrl: 'https://tray.example',
    }), /missing collections: YM722/);
});

test('detects stale deployed file fingerprints', () => {
    const manifest = createManifest('https://tray.example');
    manifest.sections.eirna.fileVersions[0] = 'stale';

    assert.throws(() => assertManifestMatchesCatalog({
        manifest,
        catalog,
        assetLock,
        baseUrl: 'https://tray.example',
    }), /eirna fileVersions/);
});

test('detects stale deployed display fingerprints', () => {
    const manifest = createManifest('https://tray.example');
    manifest.sections.eirna.previewVersions[0] = 'stale';

    assert.throws(() => assertManifestMatchesCatalog({
        manifest,
        catalog,
        assetLock,
        baseUrl: 'https://tray.example',
    }), /eirna previewVersions/);
});
