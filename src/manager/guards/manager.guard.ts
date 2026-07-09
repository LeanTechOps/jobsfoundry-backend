import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '@prisma/client'

@Injectable()
export class ManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user
    if (!user || (user.role !== UserRole.MANAGER && user.role !== UserRole.ADMIN)) {
      throw new ForbiddenException('Manager access required')
    }
    return true
  }
}
