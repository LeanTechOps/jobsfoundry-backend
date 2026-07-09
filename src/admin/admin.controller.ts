import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common'
import { AdminService } from './admin.service'
import { AdminGuard } from './guards/admin.guard'
import { StaffGuard } from 'src/auth/guards/staff.guard'
import { ListUsersDto } from './dto/list-users.dto'
import { UpdateUserRoleDto } from './dto/update-user-role.dto'

/** All staff (admin/manager/recruiter) can read data via /admin endpoints. */
@Controller('admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboardStats() {
    return this.adminService.getDashboardStats()
  }

  @Get('skills')
  getDistinctSkills() {
    return this.adminService.getDistinctSkills()
  }

  @Get('resumes/:resumeId/url')
  getResumeDownloadUrl(@Param('resumeId') resumeId: string) {
    return this.adminService.getResumeDownloadUrl(resumeId)
  }

  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.adminService.listUsers(query)
  }

  @Get('users/:id')
  getUserProfile(@Param('id') id: string) {
    return this.adminService.getUserProfile(id)
  }

  /** Admin-only: assign a role to any user */
  @Patch('users/:id/role')
  @UseGuards(AdminGuard)
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(id, dto.role)
  }
}
