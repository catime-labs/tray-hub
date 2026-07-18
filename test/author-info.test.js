import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAuthorInfo } from '../scripts/read-author-info.mjs';

test('parses centrally maintained author links from README headings', () => {
    const authors = parseAuthorInfo(`# tray-hub

## Author Information

### eirna
- Avatar: artist-picture.png

- [Bilibili](https://space.bilibili.com/1195508399)
- [Pixiv](https://www.pixiv.net/users/123)

## API

Not author metadata.
`);

    assert.deepEqual(authors.eirna, {
        name: 'eirna',
        avatar: '/avatars/artist-picture.png',
        links: [
            { label: 'Bilibili', url: 'https://space.bilibili.com/1195508399' },
            { label: 'Pixiv', url: 'https://www.pixiv.net/users/123' },
        ],
    });
});

test('rejects invalid and duplicate author links', () => {
    assert.throws(() => parseAuthorInfo(`## Author Information
### eirna
- Avatar: /outside/avatar.webp
`), /filename/);

    assert.throws(() => parseAuthorInfo(`## Author Information
### eirna
- [Bilibili](javascript:evil)
`), /valid URL|HTTP/);

    assert.throws(() => parseAuthorInfo(`## Author Information
### eirna
- [Bilibili](https://example.com/1)
- [bilibili](https://example.com/2)
`), /duplicate/);
});
