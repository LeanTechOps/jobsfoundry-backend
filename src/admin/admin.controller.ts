import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { AdminService } from './admin.service'
import { AdminGuard } from './guards/admin.guard'
import { ListUsersDto } from './dto/list-users.dto'

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  getDashboardStats() {
    return this.adminService.getDashboardStats()
  }

  @Get('users')
  listUsers(@Query() query: ListUsersDto) {
    return this.adminService.listUsers(query)
  }

  @Get('users/:id')
  getUserProfile(@Param('id') id: string) {
    return this.adminService.getUserProfile(id)
  }
}
