import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    discoveryRecord,
    inspectRepository,
} from './repository-discovery.mjs';

const organization = process.env.TRAY_GITHUB_ORG || 'catime-labs';
const token = process.env.GITHUB_TOKEN;
const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = resolve(projectRoot, '..');
const destinationRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : root;
const discoveryPath = resolve(projectRoot, '.cache/discovered-repositories.json');
const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'catime-labs/tray-hub',
    'X-GitHub-Api-Version': '2022-11-28',
};
if (token) headers.Authorization = `Bearer ${token}`;

const repositories = await listRepositories();
const candidates = repositories.filter(repository =>
    repository.name !== 'tray-hub'
    && repository.default_branch
    && !repository.archived
    && !repository.disabled
    && !repository.fork);
const inspected = await mapLimit(candidates, 6, async repository => {
    const tree = await repositoryTree(repository);
    return {
        repository,
        tree,
        inspection: inspectRepository(tree),
    };
});
const selected = inspected.filter(item => item?.inspection.shouldCheckout);
const discovery = { version: 1, repositories: {} };

await mapLimit(selected, 2, async ({ repository, tree }) => {
    const destination = resolve(destinationRoot, repository.name);
    await run('git', [
        'clone',
        '--depth', '1',
        '--branch', repository.default_branch,
        repository.clone_url,
        destination,
    ]);
    discovery.repositories[repository.name] = discoveryRecord(repository, tree);
});

if (selected.length === 0) {
    throw new Error(`No public repositories matching the tray author structure were found in ${organization}`);
}
await mkdir(resolve(projectRoot, '.cache'), { recursive: true });
await writeFile(discoveryPath, `${JSON.stringify(discovery, null, 2)}\n`);
console.log(`Automatically discovered ${selected.length} public tray repositories.`);

async function listRepositories() {
    const repositories = [];
    for (let page = 1; ; page += 1) {
        const response = await githubApi(`/orgs/${organization}/repos?type=public&per_page=100&page=${page}`);
        repositories.push(...response);
        if (response.length < 100) return repositories;
    }
}

function repositoryTree(repository) {
    return githubApi(
        `/repos/${repository.full_name}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
        { allowStatuses: [404, 409] },
    );
}

async function githubApi(path, { allowStatuses = [] } = {}) {
    const response = await fetch(`https://api.github.com${path}`, { headers });
    if (allowStatuses.includes(response.status)) return null;
    if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}`);
    return response.json();
}

function run(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => code === 0
            ? resolvePromise()
            : reject(new Error(`${command} exited with code ${code}`)));
    });
}

async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const current = index;
            index += 1;
            results[current] = await mapper(items[current], current);
        }
    });
    await Promise.all(workers);
    return results;
}
