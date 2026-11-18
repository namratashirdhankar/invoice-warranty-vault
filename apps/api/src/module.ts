import 'reflect-metadata';
import { Module, Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, Res, UploadedFile, UploadedFiles, UseInterceptors, UseGuards, BadRequestException, ServiceUnavailableException, NotFoundException, Injectable, OnModuleDestroy, ConflictException, UnauthorizedException } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { PrismaClient, Prisma } from '@prisma/client';
import { diskStorage, memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { resolve, extname } from 'path';
import { hash, compare } from 'bcryptjs';
import { AuthGuard, CurrentUser, tokenFor } from './security';
import { OAuth2Client } from 'google-auth-library';
import { ExtractionService } from './extraction';
import { InvoiceStorage } from './storage';
import { AssistantService } from './assistant';
import { ReminderService } from './reminders';

const chatPhotoOptions = {
  limits: { fileSize: 4 * 1024 * 1024, files: 5 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => cb(['image/jpeg','image/png','image/webp'].includes(file.mimetype) ? null : new BadRequestException('Only JPEG, PNG, or WebP photos are accepted'), ['image/jpeg','image/png','image/webp'].includes(file.mimetype)),
  storage: memoryStorage(),
};
const googleOAuthClient = new OAuth2Client();
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || './uploads');
const fileOptions = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => cb(null, ['application/pdf','image/jpeg','image/png'].includes(file.mimetype)),
  storage: diskStorage({
    destination: (_req, _file, cb) => { mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
    filename: (_req, file, cb) => cb(null, randomUUID() + extname(file.originalname).toLowerCase())
  })
};
@Injectable()
class Db extends PrismaClient implements OnModuleDestroy { async onModuleDestroy() { await this.$disconnect(); } }
@Controller()
class ApiController {
  constructor(private readonly db: Db, private readonly extraction: ExtractionService, private readonly assistant: AssistantService, private readonly storage: InvoiceStorage) {}
  @Get('health') health() { return { status: 'ok' }; }

  @Post('auth/register')
  async register(@Body() body: { email: string; password: string }) {
    const email = body?.email?.trim().toLowerCase();
    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email) || !body.password || body.password.length < 10) throw new BadRequestException('Valid email and password of at least 10 characters required');
    if (await this.db.user.findUnique({ where: { email } })) throw new ConflictException('Email already registered');
    const user = await this.db.user.create({ data: { email, passwordHash: await hash(body.password, 12) } });
    return { token: tokenFor(user.id), email: user.email };
  }
  @Post('auth/login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.db.user.findUnique({ where: { email: body?.email?.trim().toLowerCase() || '' } });
    if (!user || !body?.password || !(await compare(body.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    return { token: tokenFor(user.id), email: user.email };
  }

  @Post('auth/google')
  async googleLogin(@Body() body: { idToken?: string }) {
    const audiences = (process.env.GOOGLE_CLIENT_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!audiences.length) throw new ServiceUnavailableException('Google sign-in is not configured on the API');
    if (typeof body?.idToken !== 'string' || body.idToken.length < 100 || body.idToken.length > 12000) throw new BadRequestException('A valid Google ID token is required');
    let payload;
    try { payload = (await googleOAuthClient.verifyIdToken({ idToken: body.idToken, audience: audiences })).getPayload(); }
    catch { throw new UnauthorizedException('Google sign-in token could not be verified'); }
    const email = payload?.email?.trim().toLowerCase();
    if (!email || payload?.email_verified !== true) throw new UnauthorizedException('Google account must have a verified email address');
    let user = await this.db.user.findUnique({ where: { email } });
    if (!user) user = await this.db.user.create({ data: { email, passwordHash: await hash(randomUUID(), 12) } });
    return { token: tokenFor(user.id), email: user.email };
  }

  @UseGuards(AuthGuard)
  @Get('invoices')
  invoices(@CurrentUser() userId: string) { return this.db.invoice.findMany({ where: { userId }, include: { items: { include: { product: true, warranty: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }

  @UseGuards(AuthGuard)
  @Delete('invoices/:id')
  async deleteInvoice(@CurrentUser() userId: string, @Param('id') id: string) {
    const invoice = await this.ownedInvoice(userId, id);
    const lines = await this.db.invoiceItem.findMany({ where: { invoiceId: id }, select: { id: true, productId: true } });
    await this.db.$transaction(async tx => {
      await tx.warranty.deleteMany({ where: { itemId: { in: lines.map(line => line.id) } } });
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      for (const productId of new Set(lines.map(line => line.productId))) {
        if (await tx.invoiceItem.count({ where: { productId } }) === 0) {
          await tx.supportContact.deleteMany({ where: { productId } });
          await tx.product.deleteMany({ where: { id: productId, userId } });
        }
      }
    });
    await this.storage.remove(invoice.fileKey);
    return { deleted: true };
  }

  @UseGuards(AuthGuard)
  @Post('invoices/upload')
  @UseInterceptors(FileInterceptor('file', fileOptions))
  async upload(@CurrentUser() userId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('PDF, JPEG or PNG required (max 10MB)');
    const invoice = await this.db.invoice.create({ data: { userId, fileKey: await this.storage.store(userId,file), mimeType: file.mimetype } });
    return { id: invoice.id, status: invoice.status };
  }

  private async ownedInvoice(userId: string, id: string) {
    const invoice = await this.db.invoice.findFirst({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
  @UseGuards(AuthGuard)
  @Post('invoices/:id/extract')
  async extract(@CurrentUser() userId: string, @Param('id') id: string) {
    const invoice = await this.ownedInvoice(userId, id);
    const file = await this.storage.readForExtraction(invoice.fileKey);
    return { invoiceId: id, preview: await this.extraction.extract(file.bytes, invoice.mimeType), requiresReview: true };
  }
  @UseGuards(AuthGuard)
  @Get('invoices/:id/download-link')
  async downloadLink(@CurrentUser() userId: string, @Param('id') id: string) {
    const invoice = await this.ownedInvoice(userId,id);
    const url = await this.storage.downloadUrl(invoice.fileKey);
    if (!url) throw new ServiceUnavailableException('Set S3_BUCKET to enable mobile invoice viewing');
    return { url, expiresInSeconds:60 };
  }
  @UseGuards(AuthGuard)
  @Get('invoices/:id/file')
  async download(@CurrentUser() userId: string, @Param('id') id: string, @Res() res: any) {
    const invoice = await this.ownedInvoice(userId, id);
    const url = await this.storage.downloadUrl(invoice.fileKey);
    if (url) return res.redirect(url);
    const local = await this.storage.downloadLocal(invoice.fileKey);
    res.type(invoice.mimeType);
    return res.sendFile(local.filename, { root: local.root });
  }
  @UseGuards(AuthGuard)
  @Post('invoices/:id/confirm')
  async confirm(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: any) {
    const currentInvoice = await this.ownedInvoice(userId, id);
    if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 100) throw new BadRequestException('At least one product required');
    if (body.items.some((item: any) => typeof item.name !== 'string' || !item.name.trim())) throw new BadRequestException('Each product needs a name');
    const date = (v: any) => v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null;
    const normalize = (value: unknown) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\\s\\p{P}\\p{S}]+/gu, '');
    const invoiceNumber = normalize(body.invoiceNumber);
    if (invoiceNumber) {
      const seller = normalize(body.seller);
      const candidates = await this.db.invoice.findMany({ where: { userId, status: 'CONFIRMED', invoiceNumber: { not: null }, id: { not: id } }, select: { id: true, invoiceNumber: true, seller: true } });
      if (candidates.some(existing => normalize(existing.invoiceNumber) === invoiceNumber && normalize(existing.seller) === seller)) {
        throw new ConflictException('An invoice with this invoice number and seller is already saved. Check your invoices before continuing.');
      }
    }
    return this.db.$transaction(async tx => {
      const previous = await tx.invoiceItem.findMany({ where: { invoiceId: id }, select: { id:true,productId:true } });
      await tx.warranty.deleteMany({ where: { itemId: { in: previous.map(x=>x.id) } } });
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      const invoice = await tx.invoice.update({ where: { id }, data: {
        invoiceNumber: body.invoiceNumber || null, seller: body.seller || null, purchaseDate: date(body.purchaseDate),
        currency: body.currency || 'INR', total: body.total == null ? null : new Prisma.Decimal(body.total), status: 'CONFIRMED'
      } });
      for (const item of body.items) {
        const product = await tx.product.create({ data: { userId, name: item.name.trim(), brand: item.brand || null, model: item.model || null, serialNumber: item.serialNumber || null } });
        const line = await tx.invoiceItem.create({ data: { invoiceId: id, productId: product.id, quantity: Math.max(1, Number(item.quantity) || 1), unitPrice: item.unitPrice == null ? null : new Prisma.Decimal(item.unitPrice) } });
        if (item.warrantyEndDate || item.warrantyStartDate || item.warrantyMonths) {
          const startsAt = date(item.warrantyStartDate) || date(body.purchaseDate);
          let expiresAt = date(item.warrantyEndDate);
          if (!expiresAt && startsAt && Number(item.warrantyMonths) > 0) {
            expiresAt = new Date(startsAt);
            expiresAt.setUTCMonth(expiresAt.getUTCMonth() + Number(item.warrantyMonths));
          }
          await tx.warranty.create({ data: { itemId: line.id, startsAt, expiresAt, source: item.warrantySource || 'USER_CONFIRMED' } });
        }
      }
      return invoice;
    });
  }
  @UseGuards(AuthGuard)
  @Get('products')
  products(@CurrentUser() userId: string) { return this.db.product.findMany({ where: { userId }, include: { items: { include: { warranty: true, invoice: true } }, support: true }, orderBy: { createdAt: 'desc' }, take: 200 }); }
  @UseGuards(AuthGuard)
  @Post('products/:id/support')
  async support(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: any) {
    const product = await this.db.product.findFirst({ where: { id, userId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!body?.name || !(body.phone || body.email || body.website)) throw new BadRequestException('Name and contact detail required');
    return this.db.supportContact.create({ data: { productId: id, name: body.name, phone: body.phone || null, email: body.email || null, website: body.website || null, sourceUrl: body.sourceUrl || null, verifiedAt: null } });
  }
  @UseGuards(AuthGuard)
  @Post('assistant/chat')
  @UseInterceptors(FilesInterceptor('photos', 5, chatPhotoOptions))
  chat(@CurrentUser() userId: string, @Body() body: { message?: string; productId?: string; history?: string }, @UploadedFiles() photos: Express.Multer.File[]) {
    return this.assistant.chat(userId, body, photos || []);
  }

  @UseGuards(AuthGuard)
  @Post('assistant/ask')
  ask(@CurrentUser() userId: string, @Body() body: { question: string }) {
    return this.assistant.answer(userId, body?.question);
  }
  @UseGuards(AuthGuard)
  @Post('assistant/warranty-claim-draft')
  warrantyClaimDraft(@CurrentUser() userId: string, @Body() body: { productId: string; issue: string; noticedOn?: string; stepsTried?: string }) {
    return this.assistant.createWarrantyClaimDraft(userId, body);
  }
  @UseGuards(AuthGuard)
  @Post('notifications/token')
  async registerPush(@CurrentUser() userId: string, @Body() body: { token: string }) {
    if (!body?.token || !/^ExponentPushToken\\[[^\\]]+\\]$/.test(body.token)) throw new BadRequestException('Valid Expo push token required');
    const existing = await this.db.pushToken.findUnique({ where: { token: body.token } });
    if (existing && existing.userId !== userId) throw new ConflictException('Device token is registered to another account');
    return existing || this.db.pushToken.create({ data: { token: body.token, userId } });
  }
  @UseGuards(AuthGuard)
  @Delete('notifications/token')
  async unregisterPush(@CurrentUser() userId: string, @Body() body: { token: string }) {
    return this.db.pushToken.deleteMany({ where: { userId, token: body?.token || '' } });
  }
  @UseGuards(AuthGuard)
  @Get('warranties/expiring')
  expiring(@CurrentUser() userId: string, @Query('days') days = '30') {
    const count = Math.min(365, Math.max(1, Number(days) || 30));
    return this.db.warranty.findMany({ where: { expiresAt: { gte: new Date(), lte: new Date(Date.now() + count * 86400000) }, item: { invoice: { userId } } }, include: { item: { include: { product: true, invoice: true } } } });
  }
}
@Module({ controllers: [ApiController], providers: [Db, { provide: 'DATABASE', useExisting: Db }, InvoiceStorage, ExtractionService, AssistantService, ReminderService, AuthGuard] })
export class AppModule {}
