import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, JobStatus, WorkMode } from '@prisma/client'
import { PrismaService } from 'src/prisma/prisma.service'
import { CreateJobDto } from './dto/create-job.dto'
import { UpdateJobDto } from './dto/update-job.dto'
import { ListJobsDto } from './dto/list-jobs.dto'

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateJobDto, adminId: string) {
    return this.prisma.job.create({
      data: {
        ...dto,
        skills: dto.skills ?? [],
        postedById: adminId,
        closesAt: dto.closesAt ? new Date(dto.closesAt) : undefined,
      },
    })
  }

  async findAll(query: ListJobsDto) {
    const { page = 1, limit = 20, status, type, workMode, experienceLevel, search, skill, visaSponsorship } = query
    const skip = (page - 1) * limit

    const where: Prisma.JobWhereInput = {
      ...(status && { status }),
      ...(type && { type }),
      ...(workMode && { workMode }),
      ...(experienceLevel && { experienceLevel }),
      ...(visaSponsorship !== undefined && { visaSponsorship }),
      ...(skill && { skills: { has: skill } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { company: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { location: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      }),
    }

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { postedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.job.count({ where }),
    ])

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { postedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
    if (!job) throw new NotFoundException('Job not found')
    return job
  }

  async update(id: string, dto: UpdateJobDto) {
    await this.findOne(id)
    return this.prisma.job.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.closesAt !== undefined && { closesAt: dto.closesAt ? new Date(dto.closesAt) : null }),
      },
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    await this.prisma.job.delete({ where: { id } })
    return { message: 'Job deleted' }
  }

  async getStats() {
    const [total, active, draft, closed, paused] = await Promise.all([
      this.prisma.job.count(),
      this.prisma.job.count({ where: { status: JobStatus.ACTIVE } }),
      this.prisma.job.count({ where: { status: JobStatus.DRAFT } }),
      this.prisma.job.count({ where: { status: JobStatus.CLOSED } }),
      this.prisma.job.count({ where: { status: JobStatus.PAUSED } }),
    ])
    return { total, active, draft, closed, paused }
  }
}
