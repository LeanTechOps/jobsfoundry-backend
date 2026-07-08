import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
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
}
