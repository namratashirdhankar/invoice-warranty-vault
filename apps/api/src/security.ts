import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
export const tokenFor = (id: string) => sign({ sub: id }, process.env.JWT_SECRET!, { expiresIn: '30d' });
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = (request.headers.authorization || '').replace(/^Bearer /, '');
    try {
      const payload = verify(token, process.env.JWT_SECRET!) as { sub: string };
      request.userId = payload.sub;
      return true;
    } catch { throw new UnauthorizedException('Please sign in'); }
  }
}
export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().userId as string);
