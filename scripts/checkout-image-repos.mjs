import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const organization = process.env.TRAY_GITHUB_ORG || 'catime-labs';
const token = process.env.GITHUB_TOKEN;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), '..');
const destinationRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : root;
const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'catime-labs/tray-hub',
    'X-GitHub-Api-Version': '2022-11-28',
};
if (token) headers.Authorization = `Bearer ${token}`;

const repositories = await listRepositories();
let discovered = 0;

for (const repository of repositories) {
    if (repository.name === 'tray-hub' || repository.archived || repository.fork) continue;
    if (!await containsTrayAsset(repository)) continue;

    const destination = resolve(destinationRoot, repository.name);
    await run('git', [
        'clone',
        '--depth', '1',
        '--branch', repository.default_branch,
        repository.clone_url,
        destination,
    ]);
    discovered += 1;
}

if (discovered === 0) throw new Error(`No public GIF, WebP, PNG, JPEG, or ANI repositories found in ${organization}`);
console.log(`Discovered ${discovered} image repositories.`);

async function listRepositories() {
    const repositories = [];
    for (let page = 1; ; page += 1) {
        const response = await githubApi(`/orgs/${organization}/repos?type=public&per_page=100&page=${page}`);
        repositories.push(...response);
        if (response.length < 100) return repositories;
    }
}

async function containsTrayAsset(repository) {
    const tree = await githubApi(
        `/repos/${repository.full_name}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`,
    );
    return tree.tree.some(item => item.type === 'blob' && /\.(?:ani|gif|webp|png|jpe?g)$/i.test(item.path));
}

async function githubApi(path) {
    const response = await fetch(`https://api.github.com${path}`, { headers });
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
