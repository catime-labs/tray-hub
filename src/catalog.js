import catalog from '../data/collections.json' with { type: 'json' };
import assetLock from '../data/assets-lock.json' with { type: 'json' };

export function createManifest(origin) {
    const sections = Object.fromEntries(catalog.collections.map(collection => {
        const lock = assetLock.collections[collection.key] || {};
        const displayFiles = collection.files.map(filename => `${filename}.webp`);
        return [collection.key, {
            count: collection.files.length,
            authorAvatar: versionedPublicUrl(
                collection.authorAvatar,
                origin,
                lock.avatar,
            ),
            authorLinks: normalizeAuthorLinks(collection.authorLinks),
            repository: collection.repository,
            cdnBase: `${origin}/assets/${encodeURIComponent(collection.key)}/`,
            files: collection.files,
            fileVersions: collection.files.map(filename =>
                lock.files?.[filename]?.slice(0, 12) || ''),
            posterCdnBase: `${origin}/posters/${encodeURIComponent(collection.key)}/`,
            posterFiles: displayFiles,
            posterVersions: displayFiles.map(filename =>
                lock.posters?.[filename]?.slice(0, 12) || ''),
            previewCdnBase: `${origin}/previews/${encodeURIComponent(collection.key)}/`,
            previewFiles: [...displayFiles],
            previewVersions: displayFiles.map(filename =>
                lock.previews?.[filename]?.slice(0, 12) || ''),
            updated: collection.updated,
        }];
    }));

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
