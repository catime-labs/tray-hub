import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
    buildAsset,
    outputFilename,
    parseAni,
    sourceFingerprint,
    validateSource,
} from '../scripts/asset-pipeline.mjs';

test('preserves image filenames and converts only ANI paths to GIF', () => {
    assert.equal(outputFilename('1.gif'), '1.gif');
    assert.equal(outputFilename('nested/cursor.WEBP'), 'nested/cursor.WEBP');
    assert.equal(outputFilename('still.png'), 'still.png');
    assert.equal(outputFilename('photo.jpg'), 'photo.jpg');
    assert.equal(outputFilename('photo.jpeg'), 'photo.jpeg');
    assert.equal(outputFilename('animated.ani'), 'animated.gif');
    assert.throws(() => outputFilename('video.mp4'), /Unsupported/);
});

test('preserves WebP bytes and reuses the asset cache', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tray-webp-'));
    t.after(() => rm(directory, { recursive: true, force: true }));

    const source = join(directory, 'source.webp');
    const firstOutput = join(directory, 'first.webp');
    const secondOutput = join(directory, 'second.webp');
    const cacheRoot = join(directory, 'cache');
    await sharp({ create: { width: 12, height: 10, channels: 4, background: '#ff3b7f' } })
        .webp({ lossless: true })
        .toFile(source);

    const contents = await readFile(source);
    await validateSource('source.webp', contents);
    const fingerprint = sourceFingerprint('source.webp', contents);
    const first = await buildAsset({ sourcePath: source, sourceFilename: 'source.webp', destination: firstOutput, cacheRoot, fingerprint });
    const second = await buildAsset({ sourcePath: source, sourceFilename: 'source.webp', destination: secondOutput, cacheRoot, fingerprint });

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.deepEqual(await readFile(firstOutput), contents);
    assert.deepEqual(await readFile(secondOutput), await readFile(firstOutput));
});

test('accepts valid PNG, JPG, and JPEG image sources', async () => {
    const png = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#00ff00' } }).png().toBuffer();
    const jpeg = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#0000ff' } }).jpeg().toBuffer();

    assert.equal((await validateSource('still.png', png)).format, 'png');
    assert.equal((await validateSource('photo.jpg', jpeg)).format, 'jpg');
    assert.equal((await validateSource('photo.jpeg', jpeg)).format, 'jpeg');
    await assert.rejects(validateSource('fake.png', jpeg), /not a valid PNG/);
});

test('converts ANI cursor steps and timing to an animated GIF', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tray-ani-'));
    t.after(() => rm(directory, { recursive: true, force: true }));

    const red = await cursorPng('#ff0000');
    const blue = await cursorPng('#0000ff');
    const ani = createAni([createCur(red), createCur(blue)], [6, 12], [0, 1]);
    const parsed = parseAni(ani);
    assert.equal(parsed.stepCount, 2);
    assert.deepEqual(parsed.delays, [100, 200]);
    await validateSource('cursor.ani', ani);

    const source = join(directory, 'cursor.ani');
    const output = join(directory, 'cursor.gif');
    await writeFile(source, ani);
    await buildAsset({
        sourcePath: source,
        sourceFilename: 'cursor.ani',
        destination: output,
        cacheRoot: join(directory, 'cache'),
        fingerprint: sourceFingerprint('cursor.ani', ani),
    });

    const metadata = await sharp(output, { animated: true }).metadata();
    assert.equal(metadata.format, 'gif');
    assert.equal(metadata.pages, 2);
    assert.deepEqual(metadata.delay, [100, 200]);
});

function cursorPng(background) {
    return sharp({ create: { width: 8, height: 8, channels: 4, background } }).png().toBuffer();
}

function createCur(png) {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(2, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt8(8, 6);
    header.writeUInt8(8, 7);
    header.writeUInt16LE(4, 10);
    header.writeUInt16LE(4, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(header.length, 18);
    return Buffer.concat([header, png]);
}

function createAni(frames, rates, sequence) {
    const metadata = Buffer.alloc(36);
    const values = [36, frames.length, sequence.length, 8, 8, 32, 1, 6, 1];
    values.forEach((value, index) => metadata.writeUInt32LE(value, index * 4));

    const frameList = list('fram', frames.map(frame => chunk('icon', frame)));
    const chunks = [
        chunk('anih', metadata),
        chunk('rate', dwords(rates)),
        chunk('seq ', dwords(sequence)),
        frameList,
    ];
    const body = Buffer.concat([Buffer.from('ACON'), ...chunks]);
    const header = Buffer.alloc(8);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
}

function list(type, chunks) {
    return chunk('LIST', Buffer.concat([Buffer.from(type), ...chunks]));
}

function chunk(id, data) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'ascii');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function dwords(values) {
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
    return buffer;
}
