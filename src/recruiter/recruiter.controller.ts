import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { RecruiterService } from './recruiter.service'
import { RecruiterGuard } from './guards/recruiter.guard'
import { ListUsersDto } from './dto/list-users.dto'

@Controller('recruiter')
@UseGuards(RecruiterGuard)
export class RecruiterController {
  constructor(private readonly recruiterService: RecruiterService) {}

  @Get('dashboard')
  getDashboardStats() {
    return this.recruiterService.getDashboardStats()
  }

  @Get('skills')
  getDistinctSkills() {
    return this.recruiterService.getDistinctSkills()
  }

  @Get('resumes/:resumeId/url')
  getResumeDownloadUrl(@Param('resumeId') resumeId: string) {
    return this.recruiterService.getResumeDownloadUrl(resumeId)
  }

  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.recruiterService.listUsers(query)
  }

  @Get('users/:id')
  getUserProfile(@Param('id') id: string) {
    return this.recruiterService.getUserProfile(id)
  }
}
