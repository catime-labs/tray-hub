import { extname } from 'node:path';

export const AUTHOR_AVATAR_EXTENSIONS = new Set(['.gif', '.webp', '.png', '.jpg', '.jpeg']);

const PLATFORM_LABELS = [
    { matches: hostname => hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') || hostname === 'b23.tv', label: 'Bilibili' },
    { matches: hostname => hostname === 'pixiv.net' || hostname.endsWith('.pixiv.net') || hostname === 'pixiv.me', label: 'Pixiv' },
    { matches: hostname => hostname === 'github.com' || hostname.endsWith('.github.com'), label: 'GitHub' },
    { matches: hostname => hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be', label: 'YouTube' },
    { matches: hostname => hostname === 'twitter.com' || hostname.endsWith('.twitter.com') || hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 't.co', label: 'X' },
    { matches: hostname => hostname === 'weibo.com' || hostname.endsWith('.weibo.com'), label: 'Weibo' },
    { matches: hostname => hostname === 'afdian.com' || hostname.endsWith('.afdian.com') || hostname === 'afdian.net' || hostname.endsWith('.afdian.net'), label: 'Afdian' },
];

export function parseAuthorLinks(markdown, author = 'repository') {
    const links = [];
    const seenUrls = new Set();

    for (const rawLine of markdown.split(/\r?\n/)) {
        const parsed = parseStandaloneLink(rawLine.trim());
        if (!parsed) continue;

        const url = validateUrl(parsed.url, author);
        if (seenUrls.has(url)) throw new Error(`README contains a duplicate author link for ${author}: ${url}`);
        seenUrls.add(url);

        links.push({
            label: parsed.label?.trim() || inferPlatformLabel(url),
            url,
        });
    }

    return links;
}

export function selectAuthorAvatar(filenames, author = 'repository') {
    const matches = filenames.filter(isAuthorAvatarFilename);
    if (matches.length > 1) {
        throw new Error(`${author} contains multiple author avatars: ${matches.join(', ')}`);
    }
    return matches[0] || '';
}

export function isAuthorAvatarFilename(filename) {
    if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) return false;
    const extension = extname(filename).toLowerCase();
    return AUTHOR_AVATAR_EXTENSIONS.has(extension)
        && filename.slice(0, -extname(filename).length).toLowerCase() === 'a';
}

function parseStandaloneLink(line) {
    if (!line || line.startsWith('<!--')) return null;
    const content = line.replace(/^[-*+]\s+/, '').trim();
    if (!content || content.startsWith('![')) return null;

    const markdown = content.match(/^\[([^\]]+)]\((.+)\)$/);
    if (markdown) return { label: markdown[1], url: markdown[2].trim() };

    const autolink = content.match(/^<(https?:\/\/[^<>\s]+)>$/i);
    if (autolink) return { url: autolink[1] };

    const plain = content.match(/^(https?:\/\/\S+)$/i);
    if (plain) return { url: plain[1] };

    return null;
}

function validateUrl(value, author) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`README author link for ${author} is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`README author link for ${author} must use HTTP or HTTPS`);
    }
    return url.toString();
}

function inferPlatformLabel(value) {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return PLATFORM_LABELS.find(platform => platform.matches(hostname))?.label || hostname;
}
