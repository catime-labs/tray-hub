import { readFile, writeFile } from 'node:fs/promises';

const catalogUrl = new URL('../data/collections.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'catime-labs/tray-hub',
    'X-GitHub-Api-Version': '2022-11-28',
};
const githubToken = process.env.CATALOG_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

let changed = false;

for (const collection of catalog.collections) {
    const repository = new URL(collection.repository);
    const [owner, repo] = repository.pathname.split('/').filter(Boolean);
    const endpoint = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(collection.branch)}?recursive=1`;
    const response = await fetch(endpoint, { headers });
    if (!response.ok) throw new Error(`${collection.key}: GitHub API returned ${response.status}`);

    const tree = await response.json();
    const files = tree.tree
        .filter(item => item.type === 'blob' && item.path.toLowerCase().endsWith('.gif'))
        .map(item => item.path)
        .sort(naturalCompare);

    if (JSON.stringify(files) !== JSON.stringify(collection.files)) {
        collection.files = files;
        collection.updated = new Date().toISOString();
        changed = true;
        console.log(`${collection.key}: ${files.length} GIF files`);
    }
}

if (changed) {
    catalog.updated = new Date().toISOString();
    await writeFile(catalogUrl, `${JSON.stringify(catalog, null, 2)}\n`);
} else {
    console.log('Catalog is already up to date.');
}

function naturalCompare(left, right) {
    return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}
