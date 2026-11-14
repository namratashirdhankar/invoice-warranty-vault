import { Module, Controller, Get, Post, Query, UploadedFile, UseInterceptors, BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { extname } from 'path';

@Injectable()
class Db extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() { await this.$disconnect(); }
}
@Controller()
class ApiController {
  constructor(private readonly db: Db) {}
  @Get('health')
  health() { return { status: 'ok' }; }
  @Get('invoices')
  invoices() { return this.db.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }
  @Get('products')
  products() { return this.db.product.findMany({ include: { items: { include: { warranty: true } }, support: true }, take: 100 }); }
  @Get('warranties/expiring')
  expiring(@Query('days') days = '30') {
    const count = Math.min(365, Math.max(1, Number(days) || 30));
    return this.db.warranty.findMany({ where: { expiresAt: { gte: new Date(), lte: new Date(Date.now() + count * 86400000) } }, include: { item: { include: { product: true, invoice: true } } } });
  }
  @Post('invoices/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ['application/pdf','image/jpeg','image/png'].includes(file.mimetype)),
    storage: diskStorage({
      destination: (_req, _file, cb) => { mkdirSync('uploads', { recursive: true }); cb(null, 'uploads'); },
      filename: (_req, file, cb) => cb(null, randomUUID() + extname(file.originalname).toLowerCase())
    })
  }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('PDF, JPEG or PNG file required');
    // Files are staged locally. Authentication, ownership and secure cloud storage
    // must be implemented before creating invoice database records.
    return { uploadId: file.filename, status: 'STAGED', extraction: { status: 'NOT_CONFIGURED', fields: null }, message: 'File received. AI extraction and review are not yet configured.' };
  }
}
@Module({ controllers: [ApiController], providers: [Db] })
export class AppModule {}
