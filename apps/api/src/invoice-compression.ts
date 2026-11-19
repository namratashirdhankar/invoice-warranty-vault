import sharp from 'sharp';

export async function compressInvoiceImage(bytes: Buffer, mimeType: string): Promise<Buffer | null> {
  if (!['image/jpeg', 'image/png'].includes(mimeType)) return null;
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: true });
    const metadata = await image.metadata();
    // Leave animated/multipage images and unexpected formats untouched.
    if ((metadata.pages || 1) > 1 || !['jpeg', 'png'].includes(metadata.format || '')) return null;
    const compressed = await image.rotate()
      .resize({ width: 3200, height: 3200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, effort: 4 })
      .toBuffer();
    return compressed.length < bytes.length ? compressed : null;
  } catch {
    // A decoder failure must never prevent saving or reading an invoice.
    return null;
  }
}
