import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import decodeIco from 'decode-ico';
import createGifsicle from 'gifsicle-wasm';
import sharp from 'sharp';

export const SUPPORTED_EXTENSIONS = new Set(['.ani', '.gif', '.webp']);
export const PIPELINE_VERSION = 'gif-pipeline-v2';

const MAX_SOURCE_BYTES = positiveInteger(process.env.TRAY_MAX_SOURCE_MB, 64) * 1024 * 1024;
const MAX_FRAMES = positiveInteger(process.env.TRAY_MAX_FRAMES, 1000);
const MAX_FRAME_PIXELS = positiveInteger(process.env.TRAY_MAX_FRAME_PIXELS, 4_194_304);
const MAX_TOTAL_PIXELS = positiveInteger(process.env.TRAY_MAX_TOTAL_PIXELS, 12_000_000);
const require = createRequire(import.meta.url);
const gifsicleMessages = [];
let gifsicleModule;
let gifsicleQueue = Promise.resolve();

// Each conversion job gets one libvips worker. The stage script limits the
// number of simultaneous jobs separately, keeping peak CPU and memory bounded.
sharp.concurrency(1);

export function outputFilename(sourceFilename) {
    const extension = extname(sourceFilename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported tray asset extension: ${sourceFilename}`);
    }
    return `${sourceFilename.slice(0, -extname(sourceFilename).length)}.gif`;
}

export function sourceFingerprint(sourceFilename, contents) {
    return createHash('sha256')
        .update(PIPELINE_VERSION)
        .update('\0')
        .update(sourceFilename)
        .update('\0')
        .update(contents)
        .digest('hex');
}

export async function validateSource(sourceFilename, contents) {
    if (contents.length > MAX_SOURCE_BYTES) {
        throw new Error(`${sourceFilename} exceeds the ${MAX_SOURCE_BYTES / 1024 / 1024} MB source limit`);
    }

    const extension = extname(sourceFilename).toLowerCase();
    if (extension === '.ani') {
        const ani = parseAni(contents);
        if (ani.images.length === 0) throw new Error(`${sourceFilename} contains no ANI frames`);
        if (ani.stepCount > MAX_FRAMES) throw new Error(`${sourceFilename} contains too many ANI steps`);
        for (const image of ani.images) selectCursorImage(image, ani.metadata);
        return { format: 'ani', frames: ani.stepCount };
    }

    if (extension === '.gif' && !isGif(contents)) throw new Error(`${sourceFilename} is not a GIF file`);
    if (extension === '.webp' && !isWebp(contents)) throw new Error(`${sourceFilename} is not a WebP file`);
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported tray asset: ${sourceFilename}`);

    const metadata = await sharp(contents, { animated: true, limitInputPixels: MAX_FRAME_PIXELS }).metadata();
    const frames = metadata.pages || 1;
    const width = metadata.width || 0;
    const height = metadata.pageHeight || metadata.height || 0;
    assertImageLimits(sourceFilename, width, height, frames);
    return { format: extension.slice(1), frames };
}

export async function buildGif({ sourcePath, sourceFilename, destination, cacheRoot, fingerprint }) {
    const cached = resolve(cacheRoot, `${fingerprint}.gif`);
    await mkdir(dirname(destination), { recursive: true });
    await mkdir(cacheRoot, { recursive: true });

    if (await isValidGifFile(cached)) {
        await copyFile(cached, destination);
        return {
            cacheHit: true,
            inputBytes: (await stat(sourcePath)).size,
            outputBytes: (await stat(cached)).size,
        };
    }

    const temporary = resolve(cacheRoot, `${fingerprint}-${process.pid}-${randomUUID()}`);
    const converted = `${temporary}.converted.gif`;
    const optimized = `${temporary}.optimized.gif`;
    const extension = extname(sourceFilename).toLowerCase();

    try {
        if (extension === '.gif') {
            await optimizeGif(sourcePath, optimized);
        } else if (extension === '.webp') {
            await convertWebp(sourcePath, converted);
            await optimizeGif(converted, optimized);
        } else if (extension === '.ani') {
            await convertAni(await readFile(sourcePath), converted);
            await optimizeGif(converted, optimized);
        } else {
            throw new Error(`Unsupported tray asset: ${sourceFilename}`);
        }

        const signature = (await readFile(optimized)).subarray(0, 6).toString('ascii');
        if (signature !== 'GIF87a' && signature !== 'GIF89a') {
            throw new Error(`Conversion did not produce a valid GIF for ${sourceFilename}`);
        }

        await rename(optimized, cached);
        await copyFile(cached, destination);
        return {
            cacheHit: false,
            inputBytes: (await stat(sourcePath)).size,
            outputBytes: (await stat(cached)).size,
        };
    } finally {
        await Promise.all([
            rm(converted, { force: true }),
            rm(optimized, { force: true }),
        ]);
    }
}

export function parseAni(contents) {
    const buffer = Buffer.from(contents);
    if (buffer.length < 12 || fourCc(buffer, 0) !== 'RIFF' || fourCc(buffer, 8) !== 'ACON') {
        throw new Error('Invalid ANI RIFF/ACON header');
    }

    const declaredEnd = 8 + buffer.readUInt32LE(4);
    if (declaredEnd > buffer.length) throw new Error('Truncated ANI file');
    const chunks = readChunks(buffer, 12, declaredEnd);
    const metadataChunk = findChunk(chunks, 'anih');
    if (!metadataChunk || metadataChunk.data.length < 36) throw new Error('ANI file is missing anih metadata');

    const words = readDwords(metadataChunk.data);
    const metadata = {
        cbSize: words[0],
        nFrames: words[1],
        nSteps: words[2],
        iWidth: words[3],
        iHeight: words[4],
        iBitCount: words[5],
        nPlanes: words[6],
        iDispRate: words[7],
        bfAttributes: words[8],
    };
    if ((metadata.bfAttributes & 1) === 0) throw new Error('ANI raw-frame files are not supported');

    const frameList = findList(chunks, 'fram');
    if (!frameList) throw new Error('ANI file is missing the fram list');
    const iconChunks = frameList.children.filter(chunk => chunk.id === 'icon');
    const images = (metadata.nFrames > 0 ? iconChunks.slice(0, metadata.nFrames) : iconChunks)
        .map(chunk => chunk.data);
    if (images.length === 0) throw new Error('ANI file contains no icon frames');

    const rateChunk = findChunk(chunks, 'rate');
    const sequenceChunk = findChunk(chunks, 'seq ');
    const rates = rateChunk ? readDwords(rateChunk.data) : [];
    const sequence = sequenceChunk ? readDwords(sequenceChunk.data) : [];
    const stepCount = metadata.nSteps || sequence.length || rates.length || images.length;
    if (stepCount <= 0) throw new Error('ANI file contains no animation steps');

    const order = Array.from({ length: stepCount }, (_, index) => sequence[index] ?? index % images.length);
    if (order.some(index => index < 0 || index >= images.length)) throw new Error('ANI sequence references a missing frame');
    const fallbackRate = metadata.iDispRate || 6;
    const delays = Array.from({ length: stepCount }, (_, index) =>
        Math.min(65_535, Math.max(10, Math.round((rates[index] ?? fallbackRate) * 1000 / 60))));

    return { metadata, images, order, delays, stepCount };
}

async function convertWebp(source, destination) {
    const metadata = await sharp(source, { animated: true, limitInputPixels: MAX_FRAME_PIXELS }).metadata();
    const frames = metadata.pages || 1;
    assertImageLimits(source, metadata.width || 0, metadata.pageHeight || metadata.height || 0, frames);

    const animation = {};
    if (metadata.delay?.length) animation.delay = metadata.delay;
    if (Number.isInteger(metadata.loop)) animation.loop = metadata.loop;

    await sharp(source, { animated: true, limitInputPixels: MAX_FRAME_PIXELS })
        .gif({
            reuse: false,
            effort: 4,
            colours: 256,
            dither: 1,
            interFrameMaxError: 0,
            interPaletteMaxError: 0,
            ...animation,
        })
        .toFile(destination);
}

async function convertAni(contents, destination) {
    const ani = parseAni(contents);
    if (ani.stepCount > MAX_FRAMES) throw new Error(`ANI contains more than ${MAX_FRAMES} steps`);

    const decoded = [];
    for (const image of ani.images) decoded.push(await decodeCursorFrame(image, ani.metadata));

    const left = Math.max(...decoded.map(frame => frame.hotspot.x));
    const top = Math.max(...decoded.map(frame => frame.hotspot.y));
    const right = Math.max(...decoded.map(frame => frame.width - frame.hotspot.x));
    const bottom = Math.max(...decoded.map(frame => frame.height - frame.hotspot.y));
    const width = left + right;
    const height = top + bottom;
    assertImageLimits('ANI output', width, height, ani.stepCount);

    const frameBytes = width * height * 4;
    const stack = Buffer.alloc(frameBytes * ani.stepCount);
    for (let step = 0; step < ani.stepCount; step += 1) {
        const frame = decoded[ani.order[step]];
        const offsetX = left - frame.hotspot.x;
        const offsetY = top - frame.hotspot.y;
        for (let row = 0; row < frame.height; row += 1) {
            const sourceStart = row * frame.width * 4;
            const destinationStart = step * frameBytes + ((offsetY + row) * width + offsetX) * 4;
            frame.data.copy(stack, destinationStart, sourceStart, sourceStart + frame.width * 4);
        }
    }

    await sharp(stack, {
        raw: { width, height: height * ani.stepCount, channels: 4, pageHeight: height },
    }).gif({
        reuse: false,
        effort: 4,
        colours: 256,
        dither: 1,
        interFrameMaxError: 0,
        interPaletteMaxError: 0,
        delay: ani.delays,
        loop: 0,
    }).toFile(destination);
}

async function decodeCursorFrame(contents, metadata) {
    const selected = selectCursorImage(contents, metadata);
    if (selected.width * selected.height > MAX_FRAME_PIXELS) throw new Error('ANI frame is too large');

    let data;
    let width = selected.width;
    let height = selected.height;
    if (selected.type === 'png') {
        const decoded = await sharp(Buffer.from(selected.data), { limitInputPixels: MAX_FRAME_PIXELS })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        data = decoded.data;
        width = decoded.info.width;
        height = decoded.info.height;
    } else {
        data = Buffer.from(selected.data.buffer, selected.data.byteOffset, selected.data.byteLength);
    }

    if (data.length !== width * height * 4) throw new Error('ANI frame did not decode to RGBA pixels');
    const hotspot = selected.hotspot || { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    return {
        data,
        width,
        height,
        hotspot: {
            x: Math.min(width, Math.max(0, hotspot.x)),
            y: Math.min(height, Math.max(0, hotspot.y)),
        },
    };
}

function selectCursorImage(contents, metadata) {
    const images = decodeIco(contents);
    if (images.length === 0) throw new Error('ANI icon chunk contains no images');
    return images.sort((left, right) => scoreCursorImage(right, metadata) - scoreCursorImage(left, metadata))[0];
}

function scoreCursorImage(image, metadata) {
    const dimensionMatch = Number(image.width === metadata.iWidth && image.height === metadata.iHeight);
    return dimensionMatch * 1_000_000_000 + image.width * image.height * 100 + image.bpp;
}

function readChunks(buffer, start, end) {
    const chunks = [];
    let offset = start;
    while (offset + 8 <= end) {
        const id = fourCc(buffer, offset);
        const size = buffer.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + size;
        if (dataEnd > end) throw new Error(`Truncated ANI ${id} chunk`);

        if (id === 'LIST') {
            if (size < 4) throw new Error('Invalid ANI LIST chunk');
            chunks.push({ id, type: fourCc(buffer, dataStart), children: readChunks(buffer, dataStart + 4, dataEnd) });
        } else {
            chunks.push({ id, data: buffer.subarray(dataStart, dataEnd) });
        }
        offset = dataEnd + (size % 2);
    }
    return chunks;
}

function findChunk(chunks, id) {
    for (const chunk of chunks) {
        if (chunk.id === id) return chunk;
        if (chunk.children) {
            const nested = findChunk(chunk.children, id);
            if (nested) return nested;
        }
    }
    return null;
}

function findList(chunks, type) {
    for (const chunk of chunks) {
        if (chunk.id === 'LIST' && chunk.type === type) return chunk;
        if (chunk.children) {
            const nested = findList(chunk.children, type);
            if (nested) return nested;
        }
    }
    return null;
}

function readDwords(buffer) {
    if (buffer.length % 4 !== 0) throw new Error('Invalid ANI DWORD chunk length');
    return Array.from({ length: buffer.length / 4 }, (_, index) => buffer.readUInt32LE(index * 4));
}

function fourCc(buffer, offset) {
    return buffer.toString('ascii', offset, offset + 4);
}

function assertImageLimits(name, width, height, frames) {
    if (!width || !height) throw new Error(`${name} has invalid dimensions`);
    if (frames > MAX_FRAMES) throw new Error(`${name} contains more than ${MAX_FRAMES} frames`);
    if (width * height > MAX_FRAME_PIXELS) throw new Error(`${name} exceeds the per-frame pixel limit`);
    if (width * height * frames > MAX_TOTAL_PIXELS) throw new Error(`${name} exceeds the total animation pixel limit`);
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

function optimizeGif(source, destination) {
    const task = gifsicleQueue.then(() => runGifsicle(source, destination));
    gifsicleQueue = task.catch(() => {});
    return task;
}

async function runGifsicle(source, destination) {
    const module = await getGifsicleModule();
    const id = randomUUID();
    const inputName = `/input-${id}.gif`;
    const outputName = `/output-${id}.gif`;
    const args = ['gifsicle', '--careful', '--optimize=3', inputName, '--output', outputName];
    const pointers = [];
    const argv = module._malloc((args.length + 1) * 4);
    gifsicleMessages.length = 0;

    try {
        module.FS.writeFile(inputName, await readFile(source));
        args.forEach((argument, index) => {
            const pointer = module.stringToNewUTF8(argument);
            pointers.push(pointer);
            module.setValue(argv + index * 4, pointer, 'i32');
        });
        module.setValue(argv + args.length * 4, 0, 'i32');

        const status = module._run_gifsicle(args.length, argv);
        if (status !== 0) {
            throw new Error(`Gifsicle exited with ${status}: ${gifsicleMessages.join('\n')}`);
        }
        await writeFile(destination, Buffer.from(module.FS.readFile(outputName)));
    } finally {
        pointers.forEach(pointer => module._free(pointer));
        module._free(argv);
        for (const path of [inputName, outputName]) {
            try {
                module.FS.unlink(path);
            } catch {
                // A failed conversion may not have created its output file.
            }
        }
    }
}

function getGifsicleModule() {
    gifsicleModule ??= readFile(require.resolve('gifsicle-wasm/gifsicle.wasm'))
        .then(wasmBinary => createGifsicle({
            wasmBinary,
            print: () => {},
            printErr: message => gifsicleMessages.push(message),
        }));
    return gifsicleModule;
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function isValidGifFile(path) {
    if (!await exists(path)) return false;
    const handle = await open(path, 'r');
    const bytes = Buffer.alloc(6);
    try {
        await handle.read(bytes, 0, 6, 0);
    } finally {
        await handle.close();
    }
    const signature = bytes.toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return true;
    await rm(path, { force: true });
    return false;
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
