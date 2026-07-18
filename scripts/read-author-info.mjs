export function parseAuthorInfo(markdown) {
    const authors = {};
    let inAuthorSection = false;
    let currentAuthor = null;

    for (const rawLine of markdown.split(/\r?\n/)) {
        const line = rawLine.trim();
        const secondLevel = line.match(/^##\s+(.+)$/);
        if (secondLevel) {
            inAuthorSection = secondLevel[1].trim() === 'Author Information';
            currentAuthor = null;
            continue;
        }
        if (!inAuthorSection) continue;

        const authorHeading = line.match(/^###\s+(.+)$/);
        if (authorHeading) {
            const name = authorHeading[1].trim();
            const key = name.toLowerCase();
            if (!name) throw new Error('README author heading cannot be empty');
            if (authors[key]) throw new Error(`README contains duplicate author: ${name}`);
            currentAuthor = { name, links: [] };
            authors[key] = currentAuthor;
            continue;
        }

        const avatar = line.match(/^-\s+Avatar:\s*(\S+)\s*$/i);
        if (avatar && currentAuthor) {
            currentAuthor.avatar = validateAvatarPath(avatar[1], currentAuthor.name);
            continue;
        }

        const link = line.match(/^-\s+\[([^\]]+)]\(([^)]+)\)\s*$/);
        if (link && currentAuthor) {
            const label = link[1].trim();
            const url = validateUrl(link[2].trim(), currentAuthor.name, label);
            if (currentAuthor.links.some(item => item.label.toLowerCase() === label.toLowerCase())) {
                throw new Error(`README contains duplicate ${label} link for ${currentAuthor.name}`);
            }
            currentAuthor.links.push({ label, url });
        } else if (currentAuthor && /^-\s+\[/.test(line)) {
            throw new Error(`README contains an invalid author link for ${currentAuthor.name}`);
        }
    }

    return authors;
}

function validateAvatarPath(value, author) {
    if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
        throw new Error(`README avatar for ${author} must be a filename only`);
    }
    return `/avatars/${value}`;
}

function validateUrl(value, author, label) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`README ${label} link for ${author} is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`README ${label} link for ${author} must use HTTP or HTTPS`);
    }
    return url.toString();
}
