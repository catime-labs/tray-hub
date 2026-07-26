export const TRAY_REPOSITORY_TOPIC = 'catime-tray-assets';

export function inspectRepository(repository, tree, knownCollections = new Set(), { hasMarker = false } = {}) {
    const entries = Array.isArray(tree?.tree) ? tree.tree : [];
    const paths = entries
        .filter(entry => entry.type === 'blob' && typeof entry.path === 'string')
        .map(entry => entry.path);
    const optedIn = isRemoteRepositoryOptedIn(repository, knownCollections, hasMarker)
        || paths.includes('tray.json');
    const hasAssets = paths.some(path => /\.(?:ani|gif|webp|png|jpe?g)$/i.test(path));

    return {
        optedIn,
        hasAssets,
        shouldCheckout: optedIn && (hasAssets || tree?.truncated === true),
    };
}

export function isRemoteRepositoryOptedIn(repository, knownCollections = new Set(), hasMarker = false) {
    const topics = Array.isArray(repository?.topics)
        ? repository.topics.map(topic => String(topic).toLowerCase())
        : [];
    return knownCollections.has(repository.name)
        || topics.includes(TRAY_REPOSITORY_TOPIC)
        || hasMarker;
}

export function discoveryRecord(repository, tree) {
    if (!repository?.name || !repository?.html_url || !repository?.default_branch) {
        throw new Error('GitHub returned incomplete repository metadata');
    }

    return {
        repository: repository.html_url,
        branch: repository.default_branch,
        commit: tree?.sha || '',
    };
}

export function isLocalRepositoryOptedIn(name, { knownCollections, discoveredRepositories, hasMarker }) {
    return knownCollections.has(name)
        || Object.hasOwn(discoveredRepositories, name)
        || hasMarker;
}
