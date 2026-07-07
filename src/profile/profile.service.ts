import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { Profile } from '@prisma/client'

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<Profile> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } })
    if (!profile) throw new NotFoundException('Profile not found')
    return profile
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    await this.getProfile(userId)

    // Only update fields explicitly provided — strip undefined and empty strings
    // Empty string → null (clears the field), absent field → not touched at all
    const data = Object.fromEntries(
      Object.entries(dto)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v === '' ? null : v]),
    )

    if (Object.keys(data).length === 0) {
      return this.getProfile(userId)
    }

    return this.prisma.profile.update({
      where: { userId },
      data,
    })
  }
}
