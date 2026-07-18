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
            authorAvatar: resolveAvatar(origin, collection.authorAvatar),
            authorUrl: collection.authorUrl || '',
            authorTag: collection.authorTag || '',
            authorLinks: collection.authorLinks || [],
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

function resolveAvatar(origin, avatar) {
    if (!avatar) return '';
    try {
        return new URL(avatar, origin).toString();
    } catch {
        return '';
    }
}

function repositoryName(repository) {
    return new URL(repository).pathname.split('/').filter(Boolean).at(-1);
}
