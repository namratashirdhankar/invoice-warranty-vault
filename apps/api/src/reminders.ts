import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ReminderService implements OnModuleInit, OnModuleDestroy {
  private interval?: ReturnType<typeof setInterval>;
  constructor(private readonly db: PrismaClient) {}
  onModuleInit() {
    if (process.env.ENABLE_REMINDERS !== 'true') return;
    this.run().catch(console.error);
    this.interval = setInterval(() => this.run().catch(console.error), 60 * 60 * 1000);
  }
  onModuleDestroy() { if (this.interval) clearInterval(this.interval); }
  async run() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    const tokens = await this.db.pushToken.findMany();
    const days = [30,15,7,1];
    for (const daysLeft of days) {
      const from = new Date(start.getTime() + daysLeft * 86400000);
      const to = new Date(from.getTime() + 86400000);
      const warranties = await this.db.warranty.findMany({
        where: { expiresAt: { gte:from,lt:to } },
        include: { item: { include: { product:true,invoice:true } } }
      });
      for (const warranty of warranties) {
        const recipients = tokens.filter(t => t.userId === warranty.item.invoice.userId);
        for (const recipient of recipients) {
          const key = warranty.id + ':' + daysLeft + ':' + recipient.id;
          try {
            await this.db.reminderDelivery.create({ data: { key } });
          } catch { continue; }
          try {
            const result = await fetch('https://exp.host/--/api/v2/push/send', {
              method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({ to:recipient.token, title:'Warranty expiring soon',body:warranty.item.product.name + ' warranty expires in ' + daysLeft + ' day(s)',data:{productId:warranty.item.productId} })
            });
            if (!result.ok) throw new Error('Expo push HTTP ' + result.status);
            const payload: any = await result.json();
            if (payload.data?.status === 'error') throw new Error(payload.data.message || 'Expo push rejected');
          } catch (e) {
            console.error('Push delivery failed',e);
            await this.db.reminderDelivery.delete({ where:{key} }).catch(()=>{});
          }
        }
      }
    }
  }
}
