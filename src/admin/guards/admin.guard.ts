import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '@prisma/client'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required')
    }

    return true
  }
}
