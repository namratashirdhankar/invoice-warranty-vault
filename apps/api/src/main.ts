import './env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './module';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true }); // Restrict origins in production.
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
bootstrap();
