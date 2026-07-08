import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SubscriptionPlan } from '@prisma/client'
import { PrismaService } from 'src/prisma/prisma.service'
import { ListUsersDto } from './dto/list-users.dto'

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: ListUsersDto) {
    const { page = 1, limit = 20, search, skill, visaType, plan } = query
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { firstName: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { lastName: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }),
      ...(plan && { subscription: { plan } }),
      profile: {
        ...(skill && { skills: { has: skill } }),
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
              select: { id: true, originalName: true, label: true, isDefault: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    })

    if (!user) throw new NotFoundException('User not found')
    return user
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
}
