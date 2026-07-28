import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SUPPORTED_EXTENSIONS,
    buildAsset,
    outputFilename,
    sourceFingerprint,
    validateSource,
    validateSourceSize,
} from './asset-pipeline.mjs';
import { resolveCollectionSource } from './catalog-metadata.mjs';
import { parseAuthorLinks, selectAuthorAvatar } from './read-author-info.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(root, 'data/collections.json');
const assetLockPath = resolve(root, 'data/assets-lock.json');
const oldCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const oldAssetLock = await readJson(assetLockPath, { version: '1.0.0', collections: {} });
const discovery = await readJson(resolve(root, '.cache/discovered-repositories.json'), { repositories: {} });
const oldCollections = new Map(oldCatalog.collections.map(collection => [collection.key, collection]));
const outputRoot = resolve(root, 'public/assets');
const avatarOutputRoot = resolve(root, 'public/avatars');
const cacheRoot = resolve(root, '.cache/tray-assets');
const repositoryRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : resolve(root, '..');
const githubOrganization = process.env.TRAY_GITHUB_ORG || 'catime-labs';
const skipAssetBuild = process.env.TRAY_SKIP_ASSET_BUILD === '1';
const conversionConcurrency = positiveInteger(process.env.TRAY_CONVERT_CONCURRENCY, 2);

await Promise.all([
    rm(outputRoot, { recursive: true, force: true }),
    rm(avatarOutputRoot, { recursive: true, force: true }),
]);
await Promise.all([
    mkdir(outputRoot, { recursive: true }),
    mkdir(avatarOutputRoot, { recursive: true }),
]);

const repositories = (await readdir(repositoryRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: resolve(repositoryRoot, entry.name) }))
    .filter(repository => repository.path !== root)
    .sort((left, right) => naturalCompare(left.name, right.name));

const collections = [];
const assetCollections = {};
const buildStats = { cacheHits: 0, converted: 0, inputBytes: 0, outputBytes: 0 };

for (const repository of repositories) {
    const repositoryInfo = await readRepositoryInfo(repository);
    if (!repositoryInfo.avatarFilename || !repositoryInfo.readmeFilename) continue;
    const sourceFiles = (await findSourceFiles(repository.path))
        .filter(filename => filename !== repositoryInfo.avatarFilename);
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
        validateSourceSize(sourceFilename, (await stat(sourcePath)).size);
        const contents = await readFile(sourcePath);
        await validateSource(sourceFilename, contents);
        assets.push({
            sourceFilename,
            sourcePath,
            outputFilename: output,
            fingerprint: sourceFingerprint(sourceFilename, contents),
        });
    }

    let avatarAsset = null;
    if (repositoryInfo.avatarFilename) {
        const sourcePath = resolve(repository.path, repositoryInfo.avatarFilename);
        validateSourceSize(repositoryInfo.avatarFilename, (await stat(sourcePath)).size);
        const contents = await readFile(sourcePath);
        await validateSource(repositoryInfo.avatarFilename, contents);
        avatarAsset = {
            sourceFilename: repositoryInfo.avatarFilename,
            sourcePath,
            outputFilename: repositoryInfo.avatarFilename,
            fingerprint: sourceFingerprint(repositoryInfo.avatarFilename, contents),
        };
    }

    if (!skipAssetBuild) {
        const buildJobs = assets.map(asset => ({
            ...asset,
            destination: resolve(outputRoot, repository.name, asset.outputFilename),
        }));
        if (avatarAsset) {
            buildJobs.push({
                ...avatarAsset,
                destination: resolve(avatarOutputRoot, repository.name, avatarAsset.outputFilename),
            });
        }

        await mapLimit(buildJobs, conversionConcurrency, async asset => {
            const result = await buildAsset({
                sourcePath: asset.sourcePath,
                sourceFilename: asset.sourceFilename,
                destination: asset.destination,
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
    const collectionAssetLock = { files: hashes };
    if (avatarAsset) collectionAssetLock.avatar = avatarAsset.fingerprint;
    const previous = oldCollections.get(repository.name);
    const source = resolveCollectionSource({
        name: repository.name,
        organization: githubOrganization,
        previous,
        discovered: discovery.repositories?.[repository.name],
    });
    const collectionData = {
        key: repository.name,
        repository: source.repository,
        branch: source.branch,
        files,
    };

    if (repositoryInfo.authorLinks.length > 0) collectionData.authorLinks = repositoryInfo.authorLinks;
    if (avatarAsset) collectionData.authorAvatar = `/avatars/${repository.name}/${avatarAsset.outputFilename}`;

    const unchanged = previous
        && JSON.stringify(withoutUpdated(previous)) === JSON.stringify(collectionData)
        && JSON.stringify(oldAssetLock.collections[repository.name] || {}) === JSON.stringify(collectionAssetLock);
    const collection = {
        ...collectionData,
        updated: unchanged ? previous.updated : new Date().toISOString(),
    };

    collections.push(collection);
    assetCollections[collection.key] = collectionAssetLock;
    console.log(`${repository.name}: ${assets.length} supported sources -> ${files.length} web assets`);
}

if (collections.length === 0) {
    throw new Error(`No sibling repositories with README.md, a root a.* avatar, and supported animations were found in ${repositoryRoot}`);
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
    console.log(`Catalog: ${collections.length} collections, ${totalFiles} asset outputs (build skipped)`);
} else {
    console.log(`Catalog: ${collections.length} collections, ${totalFiles} asset outputs`);
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

async function readRepositoryInfo(repository) {
    const entries = (await readdir(repository.path, { withFileTypes: true }))
        .filter(entry => entry.isFile())
        .map(entry => entry.name);
    const avatarFilename = selectAuthorAvatar(entries, repository.name);
    const readmes = entries.filter(filename => filename.toLowerCase() === 'readme.md');
    if (readmes.length > 1) {
        throw new Error(`${repository.name} contains multiple README.md files with different casing`);
    }
    const readmeFilename = readmes[0] || '';
    const authorLinks = !readmeFilename
        ? []
        : parseAuthorLinks(await readFile(resolve(repository.path, readmeFilename), 'utf8'), repository.name);
    return { avatarFilename, readmeFilename, authorLinks };
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
