import catalog from '../data/collections.json' with { type: 'json' };
import assetLock from '../data/assets-lock.json' with { type: 'json' };
import { assertPublishedAsset, selectFormatSamples } from './asset-signature.mjs';
import { assertManifestMatchesCatalog } from './deployment-catalog.mjs';

const baseUrl = (process.env.TRAY_HUB_URL || 'https://tray.cati.me').replace(/\/$/, '');
const verificationId = process.env.TRAY_VERIFY_TOKEN || Date.now().toString(36);
const attempts = positiveInteger(process.env.TRAY_VERIFY_ATTEMPTS, 6);

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
        await verify();
        console.log(`Deployment verified on attempt ${attempt}.`);
        process.exit(0);
    } catch (error) {
        lastError = error;
        console.warn(`Verification attempt ${attempt}/${attempts} failed: ${error.message}`);
        if (attempt < attempts) await delay(5000);
    }
}

throw lastError;

async function verify() {
    const health = await fetch(`${baseUrl}/health?verify=${verificationId}`, { cache: 'no-store' });
    if (!health.ok) throw new Error(`health returned ${health.status}`);

    const manifestResponse = await fetch(`${baseUrl}/sections.json?verify=${verificationId}`, { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`manifest returned ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    assertManifestMatchesCatalog({ manifest, catalog, assetLock, baseUrl });
    const sections = Object.values(manifest.sections || {});
    if (sections.length === 0) throw new Error('manifest contains no collections');

    for (const section of sections) {
        if (!Array.isArray(section.files) || section.files.length === 0) {
            throw new Error(`${section.repository || 'collection'} contains no files`);
        }
        if (!section.authorAvatar) throw new Error(`${section.repository || 'collection'} contains no author avatar`);
        const avatarUrl = new URL(section.authorAvatar);
        await verifyPublishedAsset(avatarUrl.toString(), avatarUrl.pathname);

        await verifySectionDisplayAsset(section, 'poster');
        await verifySectionDisplayAsset(section, 'preview');

        for (const sample of selectFormatSamples(section.files)) {
            await verifyVersionedAsset(
                section.cdnBase,
                sample.filename,
                section.fileVersions?.[sample.index],
            );
        }
    }
}

async function verifySectionDisplayAsset(section, kind) {
    const files = section[`${kind}Files`];
    const versions = section[`${kind}Versions`];
    const cdnBase = section[`${kind}CdnBase`];
    if (!Array.isArray(files) || files.length !== section.files.length || !cdnBase) {
        throw new Error(`${section.repository || 'collection'} contains invalid ${kind} assets`);
    }
    await verifyVersionedAsset(cdnBase, files[0], versions?.[0]);
}

async function verifyVersionedAsset(cdnBase, filename, version) {
    const encodedFilename = filename.split('/').map(encodeURIComponent).join('/');
    const assetUrl = `${cdnBase}${encodedFilename}?v=${version || verificationId}`;
    await verifyPublishedAsset(assetUrl, filename);
}

async function verifyPublishedAsset(assetUrl, filename) {
    const asset = await fetch(assetUrl, {
        cache: 'no-store',
        headers: { Range: 'bytes=0-11' },
    });
    if (!asset.ok) throw new Error(`${assetUrl} returned ${asset.status}`);
    assertPublishedAsset(
        filename,
        asset.headers.get('Content-Type'),
        await readPrefix(asset, 12),
    );
}

async function readPrefix(response, length) {
    if (!response.body) throw new Error('asset response has no body');

    const reader = response.body.getReader();
    const bytes = [];
    while (bytes.length < length) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes.push(...value.subarray(0, length - bytes.length));
    }
    await reader.cancel();
    return Uint8Array.from(bytes);
}

function positiveInteger(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
