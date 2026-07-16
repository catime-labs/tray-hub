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
    const sections = Object.values(manifest.sections || {});
    if (sections.length === 0) throw new Error('manifest contains no collections');

    for (const section of sections) {
        if (!Array.isArray(section.files) || section.files.length === 0) {
            throw new Error(`${section.title || 'collection'} contains no files`);
        }
        const filename = section.files[0].split('/').map(encodeURIComponent).join('/');
        const assetUrl = `${section.cdnBase}${filename}?v=${section.fileVersions?.[0] || verificationId}`;
        const asset = await fetch(assetUrl, {
            cache: 'no-store',
            headers: { Range: 'bytes=0-5' },
        });
        if (!asset.ok) throw new Error(`${assetUrl} returned ${asset.status}`);
        if (asset.headers.get('Content-Type') !== 'image/gif') {
            throw new Error(`${assetUrl} returned ${asset.headers.get('Content-Type')}`);
        }
        const signature = await readSignature(asset);
        if (signature !== 'GIF87a' && signature !== 'GIF89a') {
            throw new Error(`${assetUrl} is not a valid GIF`);
        }
    }
}

async function readSignature(response) {
    if (!response.body) throw new Error('asset response has no body');

    const reader = response.body.getReader();
    const bytes = [];
    while (bytes.length < 6) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes.push(...value.subarray(0, 6 - bytes.length));
    }
    await reader.cancel();
    return new TextDecoder().decode(Uint8Array.from(bytes));
}

function positiveInteger(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
