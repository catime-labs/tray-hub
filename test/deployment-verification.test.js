import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublishedAsset, selectFormatSamples } from '../scripts/asset-signature.mjs';

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
