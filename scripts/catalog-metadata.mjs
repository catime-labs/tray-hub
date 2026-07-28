export function resolveCollectionSource({ name, organization, previous = {}, discovered = {} }) {
    const repository = discovered.repository
        || previous.repository
        || `https://github.com/${organization}/${name}`;
    const branch = discovered.branch || previous.branch || 'main';

    return {
        repository: validateRepositoryUrl(repository, name),
        branch: validateBranch(branch, name),
    };
}

export function validateRepositoryUrl(value, collectionName) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${collectionName} repository must be a valid HTTPS URL`);
    }

    if (url.protocol !== 'https:' || url.username || url.password
        || !url.hostname || !url.pathname.split('/').some(Boolean)) {
        throw new Error(`${collectionName} repository must be a public HTTPS URL without credentials`);
    }
    return url.toString().replace(/\/$/, '');
}

export function validateBranch(value, collectionName) {
    const branch = typeof value === 'string' ? value.trim() : '';
    const components = branch.split('/');
    const invalid = !branch
        || branch === '@'
        || branch.startsWith('-')
        || branch.startsWith('/')
        || branch.endsWith('.')
        || branch.endsWith('/')
        || components.some(component => !component || component.startsWith('.') || component.endsWith('.lock'))
        || branch.includes('..')
        || branch.includes('//')
        || branch.includes('@{')
        || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch);
    if (invalid) throw new Error(`${collectionName} contains an invalid Git branch name`);
    return branch;
}
