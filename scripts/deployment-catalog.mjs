export function assertManifestMatchesCatalog({ manifest, catalog, assetLock, baseUrl }) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('manifest is not a JSON object');
    }
    if (!catalog || !Array.isArray(catalog.collections)) {
        throw new Error('local catalog does not contain collections');
    }

    assertEqual(manifest.version, catalog.version, 'manifest version');
    assertEqual(manifest.generated, catalog.updated, 'manifest revision');

    const sections = manifest.sections && typeof manifest.sections === 'object'
        ? manifest.sections
        : {};
    const expectedKeys = catalog.collections.map(collection => collection.key).sort(naturalCompare);
    const actualKeys = Object.keys(sections).sort(naturalCompare);
    const missing = expectedKeys.filter(key => !actualKeys.includes(key));
    const unexpected = actualKeys.filter(key => !expectedKeys.includes(key));
    if (missing.length > 0) throw new Error(`manifest is missing collections: ${missing.join(', ')}`);
    if (unexpected.length > 0) throw new Error(`manifest contains unexpected collections: ${unexpected.join(', ')}`);

    const origin = new URL(baseUrl).origin;
    for (const collection of catalog.collections) {
        const section = sections[collection.key];
        const lock = assetLock?.collections?.[collection.key] || {};
        const expectedVersions = collection.files.map(filename => lock.files?.[filename]?.slice(0, 12) || '');
        const expectedDisplayFiles = collection.files.map(filename => `${filename}.webp`);
        const expectedPosterVersions = expectedDisplayFiles.map(filename => lock.posters?.[filename]?.slice(0, 12) || '');
        const expectedPreviewVersions = expectedDisplayFiles.map(filename => lock.previews?.[filename]?.slice(0, 12) || '');
        const expectedAvatar = versionedPublicUrl(collection.authorAvatar, origin, lock.avatar);

        assertEqual(section.count, collection.files.length, `${collection.key} count`);
        assertEqual(section.files, collection.files, `${collection.key} files`);
        assertEqual(section.fileVersions, expectedVersions, `${collection.key} fileVersions`);
        assertEqual(section.posterCdnBase, `${origin}/posters/${encodeURIComponent(collection.key)}/`, `${collection.key} posterCdnBase`);
        assertEqual(section.posterFiles, expectedDisplayFiles, `${collection.key} posterFiles`);
        assertEqual(section.posterVersions, expectedPosterVersions, `${collection.key} posterVersions`);
        assertEqual(section.previewCdnBase, `${origin}/previews/${encodeURIComponent(collection.key)}/`, `${collection.key} previewCdnBase`);
        assertEqual(section.previewFiles, expectedDisplayFiles, `${collection.key} previewFiles`);
        assertEqual(section.previewVersions, expectedPreviewVersions, `${collection.key} previewVersions`);
        assertEqual(section.authorAvatar || '', expectedAvatar, `${collection.key} authorAvatar`);
        assertEqual(section.authorLinks || [], collection.authorLinks || [], `${collection.key} authorLinks`);
        assertEqual(section.repository, collection.repository, `${collection.key} repository`);
        assertEqual(section.cdnBase, `${origin}/assets/${encodeURIComponent(collection.key)}/`, `${collection.key} cdnBase`);
        assertEqual(section.updated, collection.updated, `${collection.key} updated`);
    }
}

function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label} does not match the local catalog`);
    }
}

function versionedPublicUrl(value, origin, fingerprint) {
    if (!value) return '';
    const url = new URL(value, origin);
    if (fingerprint) url.searchParams.set('v', fingerprint.slice(0, 12));
    return url.toString();
}

function naturalCompare(left, right) {
    return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}
