import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SubscriptionPlan, UserRole } from '@prisma/client'
import { PrismaService } from 'src/prisma/prisma.service'
import { S3Service } from 'src/s3/s3.service'
import { ListUsersDto } from './dto/list-users.dto'

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async getResumeDownloadUrl(resumeId: string) {
    const resume = await this.prisma.resume.findUnique({ where: { id: resumeId } })
    if (!resume) throw new NotFoundException('Resume not found')
    const downloadUrl = await this.s3.getPresignedDownloadUrl(resume.key)
    return { downloadUrl, fileName: resume.originalName }
  }

  async getDistinctSkills(): Promise<string[]> {
    const profiles = await this.prisma.profile.findMany({
      where: { skills: { isEmpty: false } },
      select: { skills: true },
    })
    const all = profiles.flatMap((p) => p.skills)
    return [...new Set(all)].sort((a, b) => a.localeCompare(b))
  }

  async listUsers(query: ListUsersDto) {
    const { page = 1, limit = 20, search, skills, visaType, plan, role } = query
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {
      ...(role && { role }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { firstName: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { lastName: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }),
      ...(plan && { subscription: { plan } }),
      profile: {
        ...(skills?.length && { skills: { hasSome: skills } }),
        ...(visaType && { visaType }),
      },
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          createdAt: true,
          subscription: { select: { plan: true, status: true } },
          profile: {
            select: {
              headline: true,
              location: true,
              skills: true,
              visaType: true,
              resumes: { select: { id: true, originalName: true, isDefault: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        createdAt: true,
        subscription: {
          select: { plan: true, status: true, currentPeriodEnd: true, billingCycle: true },
        },
        profile: {
          select: {
            headline: true,
            bio: true,
            location: true,
            phoneNumber: true,
            linkedinUrl: true,
            githubUrl: true,
            portfolioUrl: true,
            address: true,
            city: true,
            state: true,
            country: true,
            zipCode: true,
            visaType: true,
            skills: true,
            resumes: {
              select: { id: true, key: true, originalName: true, label: true, isDefault: true, createdAt: true, thumbnailKey: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    })

    if (!user) throw new NotFoundException('User not found')

    // Attach presigned URLs (thumbnail + download) for resumes
    const resumesWithUrls = user.profile
      ? await Promise.all(
          user.profile.resumes.map(async (r) => {
            const [thumbnailUrl, downloadUrl] = await Promise.all([
              r.thumbnailKey ? this.s3.getPresignedDownloadUrl(r.thumbnailKey, 3600) : null,
              this.s3.getPresignedDownloadUrl(r.key, 3600),
            ])
            return { ...r, thumbnailUrl, downloadUrl }
          }),
        )
      : []

    return {
      ...user,
      profile: user.profile ? { ...user.profile, resumes: resumesWithUrls } : null,
    }
  }

  async getDashboardStats() {
    const [totalUsers, totalJobs, planBreakdown, recentUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.job.count(),
      this.prisma.subscription.groupBy({
        by: ['plan'],
        _count: { plan: true },
      }),
      this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatar: true,
          createdAt: true,
          subscription: { select: { plan: true } },
        },
      }),
    ])

    const plans = planBreakdown.reduce(
      (acc, row) => {
        acc[row.plan] = row._count.plan
        return acc
      },
      {} as Record<SubscriptionPlan, number>,
    )

    return {
      totalUsers,
      totalJobs,
      plans,
      recentUsers,
    }
  }

  async updateUserRole(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found')
    return this.prisma.user.update({ where: { id: userId }, data: { role }, select: { id: true, role: true } })
  }
}
