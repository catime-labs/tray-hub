import catalog from '../data/collections.json' with { type: 'json' };
import assetLock from '../data/assets-lock.json' with { type: 'json' };

export function findCollection(key) {
    return catalog.collections.find(collection => collection.key === key);
}

export function createManifest(origin) {
    const sections = Object.fromEntries(catalog.collections.map(collection => [
        collection.key,
        {
            count: collection.files.length,
            title: collection.title,
            author: collection.author,
            authorBio: collection.authorBio || '',
            authorAvatar: versionedPublicUrl(
                collection.authorAvatar,
                origin,
                assetLock.collections[collection.key]?.avatar,
            ),
            authorUrl: resolvePublicUrl(collection.authorUrl),
            authorTag: collection.authorTag || '',
            authorLinks: normalizeAuthorLinks(collection.authorLinks),
            description: collection.description || '',
            repository: collection.repository,
            repositoryName: repositoryName(collection.repository),
            cdnBase: `${origin}/assets/${encodeURIComponent(collection.key)}/`,
            files: collection.files,
            fileVersions: collection.files.map(filename =>
                assetLock.collections[collection.key]?.files[filename]?.slice(0, 12) || ''),
            updated: collection.updated,
        },
    ]));

    return {
        version: catalog.version,
        generated: catalog.updated,
        sections,
    };
}

export function resolvePublicUrl(value, base) {
    if (!value) return '';
    try {
        const url = new URL(value, base);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    } catch {
        return '';
    }
}

function versionedPublicUrl(value, base, fingerprint) {
    const publicUrl = resolvePublicUrl(value, base);
    if (!publicUrl || !fingerprint) return publicUrl;
    const url = new URL(publicUrl);
    url.searchParams.set('v', fingerprint.slice(0, 12));
    return url.toString();
}

function normalizeAuthorLinks(links) {
    if (!Array.isArray(links)) return [];
    return links.flatMap(link => {
        if (!link || typeof link.label !== 'string') return [];
        const label = link.label.trim();
        const url = resolvePublicUrl(link.url);
        return label && url ? [{ label, url }] : [];
    });
}

export function repositoryName(repository) {
    try {
        return new URL(repository).pathname.split('/').filter(Boolean).at(-1) || '';
    } catch {
        return '';
    }
}
