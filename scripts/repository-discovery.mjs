import { isAuthorAvatarFilename } from './read-author-info.mjs';

export function inspectRepository(tree) {
    const entries = Array.isArray(tree?.tree) ? tree.tree : [];
    const paths = entries
        .filter(entry => entry.type === 'blob' && typeof entry.path === 'string')
        .map(entry => entry.path);
    const hasReadme = paths.filter(isRootReadme).length === 1;
    const hasAvatar = paths.filter(isAuthorAvatarFilename).length === 1;
    const hasAssets = paths.some(isTrayAssetPath);

    return {
        hasReadme,
        hasAvatar,
        hasAssets,
        shouldCheckout: hasReadme && hasAvatar && hasAssets,
    };
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

function isRootReadme(path) {
    return !path.includes('/') && !path.includes('\\') && path.toLowerCase() === 'readme.md';
}

function isTrayAssetPath(path) {
    return /\.(?:ani|gif|webp|png|jpe?g)$/i.test(path) && !isAuthorAvatarFilename(path);
}
