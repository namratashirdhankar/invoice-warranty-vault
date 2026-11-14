import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class InvoiceStorage {
  private readonly bucket = process.env.S3_BUCKET;
  private readonly s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
  private readonly uploadDir = resolve(process.env.UPLOAD_DIR || './uploads');

  async store(userId: string, file: Express.Multer.File) {
    if (!this.bucket) return file.filename;
    const key = 'users/' + userId + '/invoices/' + file.filename;
    const bytes = await readFile(file.path);
    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: bytes, ContentType: file.mimetype,
        ServerSideEncryption: 'AES256'
      }));
      await unlink(file.path);
      return key;
    } catch {
      throw new ServiceUnavailableException('Could not store invoice in cloud storage');
    }
  }

  async downloadUrl(key: string) {
    if (!this.bucket) return null;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 60 });
  }

  async downloadLocal(key: string) {
    if (this.bucket) throw new ServiceUnavailableException('Cloud files must use signed downloads');
    return { root: this.uploadDir, filename: key };
  }

  async readForExtraction(key: string): Promise<{bytes: Buffer; mimeType?: string}> {
    if (!this.bucket) return { bytes: await readFile(resolve(this.uploadDir,key)) };
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new ServiceUnavailableException('Invoice file missing');
    return { bytes: Buffer.from(await response.Body.transformToByteArray()), mimeType: response.ContentType };
  }

  async remove(key: string) {
    if (this.bucket) await this.s3.send(new DeleteObjectCommand({ Bucket:this.bucket,Key:key }));
    else await unlink(resolve(this.uploadDir,key)).catch(e=>{ if(e.code !== 'ENOENT') throw e; });
  }
}
