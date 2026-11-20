const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');
const { compressInvoiceImage } = require('../dist/invoice-compression');
const { InvoiceStorage } = require('../dist/storage');
const { AppModule } = require('../dist/module');
const Controller = Reflect.getMetadata('controllers', AppModule)[0];

async function sample() {
  return sharp({ create: { width: 4000, height: 1200, channels: 3, background: 'white' } })
    .composite([{ input: Buffer.from('<svg width="4000" height="1200"><text x="100" y="300" font-size="80">INVOICE 12345 — Total 4500.00</text></svg>') }])
    .png({ compressionLevel: 0 }).toBuffer();
}

test('compresses large images, limits dimensions and never enlarges small images', async () => {
  const original = await sample();
  const compressed = await compressInvoiceImage(original, 'image/png');
  assert(compressed && compressed.length < original.length);
  const metadata = await sharp(compressed).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 3200);
  const small = await sharp({ create: { width: 100, height: 80, channels: 3, background: 'white' } }).png({ compressionLevel: 0 }).toBuffer();
  const result = await compressInvoiceImage(small, 'image/png');
  assert.equal((await sharp(result || small).metadata()).width, 100);
  console.log(`Sample image: ${original.length} → ${compressed.length} bytes`);
});

test('PDFs, unsupported images, corrupt bytes and already optimized images remain unchanged', async () => {
  assert.equal(await compressInvoiceImage(Buffer.from('%PDF signed original'), 'application/pdf'), null);
  assert.equal(await compressInvoiceImage(Buffer.from('invalid'), 'image/png'), null);
  assert.equal(await compressInvoiceImage(Buffer.from('webp'), 'image/webp'), null);
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const result = await compressInvoiceImage(tiny, 'image/jpeg');
  assert(!result || result.length < tiny.length);
});

test('local storage retains original until caller persists new reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'invoice-compression-'));
  const oldDir = process.env.UPLOAD_DIR;
  const oldBucket = process.env.S3_BUCKET;
  process.env.UPLOAD_DIR = directory;
  delete process.env.S3_BUCKET;
  try {
    const original = await sample();
    await writeFile(join(directory, 'invoice.png'), original);
    const storage = new InvoiceStorage();
    const result = await storage.optimize('invoice.png', 'image/png');
    assert(result && result.fileKey.endsWith('.webp'));
    assert.deepEqual(await readFile(join(directory, 'invoice.png')), original);
    assert.equal((await storage.readForExtraction(result.fileKey)).bytes.length, result.storedBytes);
    await storage.remove('invoice.png');
    await assert.rejects(readFile(join(directory, 'invoice.png')));
  } finally {
    if (oldDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = oldDir;
    if (oldBucket === undefined) delete process.env.S3_BUCKET; else process.env.S3_BUCKET = oldBucket;
    await rm(directory, { recursive: true, force: true });
  }
});

test('S3 stores compressed image privately with matching MIME and keeps original', async () => {
  const oldBucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = 'test-private-invoices';
  try {
    const original = await sample();
    const storage = new InvoiceStorage();
    const commands = [];
    storage.s3.send = async command => {
      commands.push(command);
      return { Body: { transformToByteArray: async () => original }, ContentType: 'image/png' };
    };
    const result = await storage.optimize('users/u/invoices/original.png', 'image/png');
    assert(result.fileKey.startsWith('users/u/invoices/'));
    assert.equal(commands.length, 2);
    const put = commands[1].input;
    assert.equal(put.Bucket, 'test-private-invoices');
    assert.equal(put.ContentType, 'image/webp');
    assert.equal(put.ServerSideEncryption, 'AES256');
    assert.equal(put.Body.length, result.storedBytes);
    assert(!put.ACL);
  } finally {
    if (oldBucket === undefined) delete process.env.S3_BUCKET; else process.env.S3_BUCKET = oldBucket;
  }
});

test('concurrent replacement discards unused candidate without deleting original', async () => {
  const removed = [];
  const storage = { optimize: async () => ({ fileKey: 'new.webp', mimeType: 'image/webp', originalBytes: 100, storedBytes: 50 }), remove: async key => removed.push(key) };
  const controller = new Controller({ invoice: { updateMany: async () => ({ count: 0 }) } }, {}, {}, storage);
  assert.equal(await controller.optimizeStoredInvoice({ id: '1', fileKey: 'old.png', mimeType: 'image/png' }), null);
  assert.deepEqual(removed, ['new.webp']);
});

test('failed database update deletes candidate, not original', async () => {
  const removed = [];
  const storage = { optimize: async () => ({ fileKey: 'new.webp', mimeType: 'image/webp', originalBytes: 100, storedBytes: 50 }), remove: async key => removed.push(key) };
  const controller = new Controller({ invoice: { updateMany: async () => { throw Error('DB unavailable'); } } }, {}, {}, storage);
  assert.equal(await controller.optimizeStoredInvoice({ id: '1', fileKey: 'old.png', mimeType: 'image/png' }), null);
  assert.deepEqual(removed, ['new.webp']);
});

test('AI extraction uses original bytes before compression and reports savings', async () => {
  const calls = [];
  const invoice = { id: '1', fileKey: 'old.png', mimeType: 'image/png' };
  const db = { invoice: { findFirst: async () => invoice, updateMany: async () => { calls.push('persist'); return { count: 1 }; } } };
  const storage = {
    readForExtraction: async () => ({ bytes: Buffer.from('original') }),
    optimize: async () => { calls.push('optimize'); return { fileKey: 'new.webp', mimeType: 'image/webp', originalBytes: 100, storedBytes: 50 }; },
    remove: async key => calls.push('remove ' + key)
  };
  const extraction = { extract: async bytes => { assert.equal(bytes.toString(), 'original'); calls.push('extract'); return { items: [] }; } };
  const result = await new Controller(db, extraction, {}, storage).extract('user', '1');
  assert.deepEqual(calls, ['extract', 'optimize', 'persist', 'remove old.png']);
  assert.equal(result.compression.savedBytes, 50);
});

test('device extraction uses supplied bytes without storing the file and checks ownership and MIME', async () => {
  const invoice = { id: '1', userId: 'owner', fileKey: 'device:', mimeType: 'application/pdf' };
  const calls = [];
  const db = { invoice: { findFirst: async ({ where }) => where.id === invoice.id && where.userId === invoice.userId ? invoice : null } };
  const extraction = { extract: async (bytes, mimeType) => { calls.push([bytes.toString(), mimeType]); return { items: [] }; } };
  const controller = new Controller(db, extraction, {}, {});
  const file = { buffer: Buffer.from('invoice'), mimetype: 'application/pdf' };
  const result = await controller.extractDevice('owner', '1', file);
  assert.deepEqual(calls, [['invoice', 'application/pdf']]);
  assert.equal(result.compression, null);
  await assert.rejects(controller.extractDevice('other', '1', file), { status: 404 });
  await assert.rejects(controller.extractDevice('owner', '1', { ...file, mimetype: 'image/png' }), { status: 400 });
  await assert.rejects(controller.extractDevice('owner', '1', undefined), { status: 400 });
});
