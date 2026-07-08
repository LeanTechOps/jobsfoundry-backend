import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { CreateJobDto } from './dto/create-job.dto'
import { UpdateJobDto } from './dto/update-job.dto'
import { ListJobsDto } from './dto/list-jobs.dto'
import { AdminGuard } from 'src/admin/guards/admin.guard'

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // Admin: create a job
  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateJobDto, @Req() req) {
    return this.jobsService.create(dto, req.user.id)
  }

  // Public (authenticated): list jobs with filters
  @Get()
  findAll(@Query() query: ListJobsDto) {
    return this.jobsService.findAll(query)
  }

  // Admin: stats
  @Get('stats')
  @UseGuards(AdminGuard)
  getStats() {
    return this.jobsService.getStats()
  }

  // Public (authenticated): single job
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id)
  }

  // Admin: update
  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.jobsService.update(id, dto)
  }

  // Admin: delete
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.jobsService.remove(id)
  }

  // ── Logo upload (same 2-step presigned flow as resumes) ──

  @Post(':id/logo/initiate')
  @UseGuards(AdminGuard)
  initiateLogoUpload(@Param('id') id: string, @Body('contentType') contentType: string) {
    return this.jobsService.initiateLogoUpload(id, contentType)
  }

  @Post(':id/logo/confirm')
  @UseGuards(AdminGuard)
  confirmLogoUpload(@Param('id') id: string, @Body('logoKey') logoKey: string) {
    return this.jobsService.confirmLogoUpload(id, logoKey)
  }

  @Get(':id/logo/url')
  @UseGuards(AdminGuard)
  getLogoUrl(@Param('id') id: string) {
    return this.jobsService.getLogoUrl(id)
  }

  @Delete(':id/logo')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  deleteLogo(@Param('id') id: string) {
    return this.jobsService.deleteLogo(id)
  }
}
