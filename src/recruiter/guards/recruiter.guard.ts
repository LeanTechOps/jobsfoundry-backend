import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { UserRole } from '@prisma/client'

@Injectable()
export class RecruiterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user
    if (!user || (user.role !== UserRole.RECRUITER && user.role !== UserRole.ADMIN)) {
      throw new ForbiddenException('Recruiter access required')
    }
    return true
  }
}
