import { Controller, Get, Patch, Body, Req } from '@nestjs/common'
import { Request } from 'express'
import { ProfileService } from './profile.service'
import { UpdateProfileDto } from './dto/update-profile.dto'

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  getProfile(@Req() req: Request) {
    const userId = (req.user as any).id
    return this.profileService.getProfile(userId)
  }

  @Patch()
  updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const userId = (req.user as any).id
    return this.profileService.updateProfile(userId, dto)
  }
}
