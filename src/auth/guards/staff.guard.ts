import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '@prisma/client'

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.RECRUITER]

@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user
    if (!user || !STAFF_ROLES.includes(user.role)) {
      throw new ForbiddenException('Staff access required')
    }
    return true
  }
}
