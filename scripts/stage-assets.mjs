import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SUPPORTED_EXTENSIONS,
    buildGif,
    outputFilename,
    sourceFingerprint,
    validateSource,
} from './asset-pipeline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(root, 'data/collections.json');
const assetLockPath = resolve(root, 'data/assets-lock.json');
const oldCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const oldAssetLock = await readJson(assetLockPath, { version: '1.0.0', collections: {} });
const oldCollections = new Map(oldCatalog.collections.map(collection => [collection.key, collection]));
const outputRoot = resolve(root, 'public/assets');
const cacheRoot = resolve(root, '.cache/tray-assets');
const repositoryRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : resolve(root, '..');
const githubOrganization = process.env.TRAY_GITHUB_ORG || 'catime-labs';
const skipAssetBuild = process.env.TRAY_SKIP_ASSET_BUILD === '1';
const conversionConcurrency = positiveInteger(process.env.TRAY_CONVERT_CONCURRENCY, 2);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const repositories = (await readdir(repositoryRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: resolve(repositoryRoot, entry.name) }))
    .filter(repository => repository.path !== root)
    .sort((left, right) => naturalCompare(left.name, right.name));

const collections = [];
const assetCollections = {};
const buildStats = { cacheHits: 0, converted: 0, inputBytes: 0, outputBytes: 0 };

for (const repository of repositories) {
    const sourceFiles = await findSourceFiles(repository.path);
    if (sourceFiles.length === 0) continue;

    const assets = [];
    const outputNames = new Map();
    for (const sourceFilename of sourceFiles) {
        const output = outputFilename(sourceFilename);
        const collisionKey = output.toLowerCase();
        if (outputNames.has(collisionKey)) {
            throw new Error(`${repository.name} contains conflicting sources for ${output}: ${outputNames.get(collisionKey)} and ${sourceFilename}`);
        }
        outputNames.set(collisionKey, sourceFilename);

        const sourcePath = resolve(repository.path, sourceFilename);
        const contents = await readFile(sourcePath);
        await validateSource(sourceFilename, contents);
        assets.push({
            sourceFilename,
            sourcePath,
            outputFilename: output,
            fingerprint: sourceFingerprint(sourceFilename, contents),
        });
    }

    if (!skipAssetBuild) {
        await mapLimit(assets, conversionConcurrency, async asset => {
            const result = await buildGif({
                sourcePath: asset.sourcePath,
                sourceFilename: asset.sourceFilename,
                destination: resolve(outputRoot, repository.name, asset.outputFilename),
                cacheRoot,
                fingerprint: asset.fingerprint,
            });
            buildStats.cacheHits += Number(result.cacheHit);
            buildStats.converted += Number(!result.cacheHit);
            buildStats.inputBytes += result.inputBytes;
            buildStats.outputBytes += result.outputBytes;
        });
    }

    const files = assets.map(asset => asset.outputFilename);
    const hashes = Object.fromEntries(assets.map(asset => [asset.outputFilename, asset.fingerprint]));
    const previous = oldCollections.get(repository.name);
    const metadata = await readMetadata(repository.path);
    const collectionData = {
        key: repository.name,
        title: metadata.title || previous?.title || repository.name,
        author: metadata.author || previous?.author || repository.name,
        repository: metadata.repository || previous?.repository
            || `https://github.com/${githubOrganization}/${repository.name}`,
        branch: metadata.branch || previous?.branch || 'main',
        files,
    };

    for (const field of ['authorBio', 'authorAvatar', 'authorUrl', 'authorTag', 'description']) {
        const value = Object.hasOwn(metadata, field) ? metadata[field] : previous?.[field];
        if (value) collectionData[field] = value;
    }

    const unchanged = previous
        && JSON.stringify(withoutUpdated(previous)) === JSON.stringify(collectionData)
        && JSON.stringify(oldAssetLock.collections[repository.name]?.files || {}) === JSON.stringify(hashes);
    const collection = {
        ...collectionData,
        updated: unchanged ? previous.updated : new Date().toISOString(),
    };

    collections.push(collection);
    assetCollections[collection.key] = { files: hashes };
    console.log(`${repository.name}: ${assets.length} supported sources -> ${files.length} GIF files`);
}

if (collections.length === 0) {
    throw new Error(`No sibling image repositories containing GIF, WebP, or ANI files were found in ${repositoryRoot}`);
}

const catalogChanged = JSON.stringify(oldCatalog.collections) !== JSON.stringify(collections);
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

const totalFiles = collections.reduce((sum, item) => sum + item.files.length, 0);
if (skipAssetBuild) {
    console.log(`Catalog: ${collections.length} collections, ${totalFiles} GIF outputs (conversion skipped)`);
} else {
    console.log(`Catalog: ${collections.length} collections, ${totalFiles} GIF outputs`);
    console.log(`Asset build: ${buildStats.converted} generated, ${buildStats.cacheHits} cache hits, ${formatBytes(buildStats.inputBytes)} -> ${formatBytes(buildStats.outputBytes)}`);
}

async function findSourceFiles(directory, current = directory) {
    const files = [];
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const path = resolve(current, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findSourceFiles(directory, path));
        } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extension(entry.name))) {
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

async function mapLimit(items, limit, mapper) {
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const current = index;
            index += 1;
            await mapper(items[current]);
        }
    });
    await Promise.all(workers);
}

function withoutUpdated(collection) {
    const { updated, ...rest } = collection;
    return rest;
}

function extension(filename) {
    const index = filename.lastIndexOf('.');
    return index < 0 ? '' : filename.slice(index).toLowerCase();
}

function naturalCompare(left, right) {
    return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
