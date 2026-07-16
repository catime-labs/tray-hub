import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(root, 'data/collections.json');
const assetLockPath = resolve(root, 'data/assets-lock.json');
const oldCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const oldAssetLock = await readJson(assetLockPath, { version: '1.0.0', collections: {} });
const oldCollections = new Map(oldCatalog.collections.map(collection => [collection.key, collection]));
const outputRoot = resolve(root, 'public/assets');
const repositoryRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : resolve(root, '..');
const githubOrganization = process.env.TRAY_GITHUB_ORG || 'catime-labs';

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const repositories = (await readdir(repositoryRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: resolve(repositoryRoot, entry.name) }))
    .filter(repository => repository.path !== root)
    .sort((left, right) => naturalCompare(left.name, right.name));

const collections = [];
const assetCollections = {};

for (const repository of repositories) {
    const files = await findGifFiles(repository.path);
    if (files.length === 0) continue;

    const previous = oldCollections.get(repository.name);
    const metadata = await readMetadata(repository.path);
    const hashes = {};

    for (const filename of files) {
        const source = resolve(repository.path, filename);
        const destination = resolve(outputRoot, repository.name, filename);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
        hashes[filename] = createHash('sha256').update(await readFile(source)).digest('hex');
    }

    const unchanged = previous
        && JSON.stringify(previous.files) === JSON.stringify(files)
        && JSON.stringify(oldAssetLock.collections[repository.name]?.files || {}) === JSON.stringify(hashes);
    const collection = {
        key: repository.name,
        title: metadata.title || previous?.title || repository.name,
        author: metadata.author || previous?.author || repository.name,
        repository: metadata.repository || previous?.repository
            || `https://github.com/${githubOrganization}/${repository.name}`,
        branch: metadata.branch || previous?.branch || 'main',
        files,
        updated: unchanged ? previous.updated : new Date().toISOString(),
    };

    for (const field of ['authorBio', 'authorAvatar', 'authorUrl', 'authorTag', 'description']) {
        const value = metadata[field] || previous?.[field];
        if (value) collection[field] = value;
    }

    collections.push(collection);
    assetCollections[collection.key] = { files: hashes };
    console.log(`${collection.key}: staged ${files.length} files`);
}

if (collections.length === 0) {
    throw new Error(`No sibling image repositories containing GIF files were found in ${repositoryRoot}`);
}

const comparableOld = oldCatalog.collections.map(withoutUpdated);
const comparableNew = collections.map(withoutUpdated);
const catalogChanged = JSON.stringify(comparableOld) !== JSON.stringify(comparableNew);
const catalog = {
    version: oldCatalog.version || '1.0.0',
    updated: catalogChanged ? new Date().toISOString() : oldCatalog.updated,
    collections,
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const assetLockChanged = JSON.stringify(oldAssetLock.collections) !== JSON.stringify(assetCollections);
const assetLock = {
    version: oldAssetLock.version || '1.0.0',
    updated: assetLockChanged ? new Date().toISOString() : oldAssetLock.updated,
    collections: assetCollections,
};
await writeFile(assetLockPath, `${JSON.stringify(assetLock, null, 2)}\n`);

console.log(`Catalog: ${collections.length} collections, ${collections.reduce((sum, item) => sum + item.files.length, 0)} GIF files`);

async function findGifFiles(directory, current = directory) {
    const files = [];
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findGifFiles(directory, path));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gif')) {
            files.push(relative(directory, path).split(sep).join('/'));
        }
    }

    return files.sort(naturalCompare);
}

async function readMetadata(repository) {
    const path = resolve(repository, 'tray.json');
    if (!await exists(path)) return {};
    return JSON.parse(await readFile(path, 'utf8'));
}

async function readJson(path, fallback) {
    if (!await exists(path)) return fallback;
    return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function withoutUpdated(collection) {
    const { updated, ...rest } = collection;
    return rest;
}

function naturalCompare(left, right) {
    return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}
