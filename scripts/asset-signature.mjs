const FORMATS = {
    '.gif': { contentType: 'image/gif', signature: isGif },
    '.webp': { contentType: 'image/webp', signature: isWebp },
    '.png': { contentType: 'image/png', signature: isPng },
    '.jpg': { contentType: 'image/jpeg', signature: isJpeg },
    '.jpeg': { contentType: 'image/jpeg', signature: isJpeg },
};

export function assertPublishedAsset(filename, contentType, contents) {
    const extension = extensionOf(filename);
    const format = FORMATS[extension];
    if (!format) throw new Error(`${filename} has an unsupported published extension`);

    const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== format.contentType) {
        throw new Error(`${filename} returned ${contentType || 'no Content-Type'}; expected ${format.contentType}`);
    }
    if (!format.signature(Buffer.from(contents))) {
        throw new Error(`${filename} does not contain a valid ${extension.slice(1).toUpperCase()} signature`);
    }
}

export function selectFormatSamples(files) {
    const samples = new Map();
    files.forEach((filename, index) => {
        const extension = extensionOf(filename);
        if (!samples.has(extension)) samples.set(extension, { filename, index });
    });
    return [...samples.values()];
}

function extensionOf(filename) {
    const index = String(filename).lastIndexOf('.');
    return index < 0 ? '' : String(filename).slice(index).toLowerCase();
}

function isGif(contents) {
    const signature = contents.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
}

function isWebp(contents) {
    return contents.length >= 12
        && contents.subarray(0, 4).toString('ascii') === 'RIFF'
        && contents.subarray(8, 12).toString('ascii') === 'WEBP';
}

function isPng(contents) {
    return contents.length >= 8
        && contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isJpeg(contents) {
    return contents.length >= 3
        && contents[0] === 0xff
        && contents[1] === 0xd8
        && contents[2] === 0xff;
}

