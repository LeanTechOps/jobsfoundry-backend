import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Request, UseGuards,
} from '@nestjs/common'
import { ApplicationsService } from './applications.service'
import { CreateApplicationDto } from './dto/create-application.dto'
import { UpdateApplicationDto } from './dto/update-application.dto'
import { AdminGuard } from 'src/admin/guards/admin.guard'

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  // ── Admin ──────────────────────────────────────────────────

  /** Create a new application (admin selects user + resume) */
  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateApplicationDto) {
    return this.svc.create(dto)
  }

  /** List all applications for a specific job */
  @Get('job/:jobId')
  @UseGuards(AdminGuard)
  findByJob(@Param('jobId') jobId: string) {
    return this.svc.findByJob(jobId)
  }

  /** Update application status, interview date, resume, or notes */
  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.svc.update(id, dto)
  }

  /** Remove an application */
  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.svc.remove(id)
  }

  // ── User (authenticated) ───────────────────────────────────

  /** Get the currently logged-in user's applications */
  @Get('me')
  findMine(@Request() req: any) {
    return this.svc.findMine(req.user.id)
  }
}
