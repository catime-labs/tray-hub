import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const destinationRoot = process.env.TRAY_ASSET_ROOT
    ? resolve(process.env.TRAY_ASSET_ROOT)
    : resolve(projectRoot, '..');
const catalog = JSON.parse(await readFile(resolve(projectRoot, 'data/collections.json'), 'utf8'));

if (!Array.isArray(catalog.collections) || catalog.collections.length === 0) {
    throw new Error('The tray asset catalog contains no collections');
}

for (const collection of catalog.collections) {
    if (!collection.key || !collection.repository) {
        throw new Error('Each catalog collection must include key and repository');
    }

    const destination = resolve(destinationRoot, collection.key);
    if (await exists(destination)) {
        console.log(`Using existing image repository: ${collection.key}`);
        continue;
    }

    await run('git', [
        'clone',
        '--depth', '1',
        '--branch', collection.branch || 'main',
        collection.repository,
        destination,
    ]);
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
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
