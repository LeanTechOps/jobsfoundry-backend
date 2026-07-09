import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ManagerService } from './manager.service'
import { ManagerGuard } from './guards/manager.guard'
import { ListUsersDto } from './dto/list-users.dto'

@Controller('manager')
@UseGuards(ManagerGuard)
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('dashboard')
  getDashboardStats() {
    return this.managerService.getDashboardStats()
  }

  @Get('skills')
  getDistinctSkills() {
    return this.managerService.getDistinctSkills()
  }

  @Get('resumes/:resumeId/url')
  getResumeDownloadUrl(@Param('resumeId') resumeId: string) {
    return this.managerService.getResumeDownloadUrl(resumeId)
  }

  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.managerService.listUsers(query)
  }

  @Get('users/:id')
  getUserProfile(@Param('id') id: string) {
    return this.managerService.getUserProfile(id)
  }
}
