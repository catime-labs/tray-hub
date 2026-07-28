import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isAuthorAvatarFilename,
    parseAuthorLinks,
    selectAuthorAvatar,
} from '../scripts/read-author-info.mjs';

test('parses standalone repository README links and infers common platform labels', () => {
    const links = parseAuthorLinks(`https://space.bilibili.com/1195508399
https://www.pixiv.net/users/123
https://x.com/example
[Portfolio](https://example.com/artist)

An inline [GitHub link](https://github.com/example) is not author metadata.
![Avatar](https://example.com/avatar.png)
`, 'eirna');

    assert.deepEqual(links, [
        { label: 'Bilibili', url: 'https://space.bilibili.com/1195508399' },
        { label: 'Pixiv', url: 'https://www.pixiv.net/users/123' },
        { label: 'X', url: 'https://x.com/example' },
        { label: 'Portfolio', url: 'https://example.com/artist' },
    ]);
});

test('rejects invalid and duplicate standalone author links', () => {
    assert.throws(() => parseAuthorLinks(`
- [Bilibili](javascript:evil)
`, 'eirna'), /HTTP/);

    assert.throws(() => parseAuthorLinks(`
https://example.com/artist
[Again](https://example.com/artist)
`, 'eirna'), /duplicate/);
});

test('reserves one root a image as the repository author avatar', () => {
    assert.equal(isAuthorAvatarFilename('a.png'), true);
    assert.equal(isAuthorAvatarFilename('A.JPEG'), true);
    assert.equal(isAuthorAvatarFilename('nested/a.png'), false);
    assert.equal(isAuthorAvatarFilename('a.ani'), false);
    assert.equal(selectAuthorAvatar(['1.gif', 'a.webp', 'README.md'], 'eirna'), 'a.webp');
    assert.throws(
        () => selectAuthorAvatar(['a.png', 'A.jpg'], 'eirna'),
        /multiple author avatars/,
    );
});
