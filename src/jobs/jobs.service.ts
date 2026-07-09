import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, JobStatus, WorkMode } from '@prisma/client'
import { PrismaService } from 'src/prisma/prisma.service'
import { S3Service } from 'src/s3/s3.service'
import { CreateJobDto } from './dto/create-job.dto'
import { UpdateJobDto } from './dto/update-job.dto'
import { ListJobsDto } from './dto/list-jobs.dto'
import { randomUUID } from 'crypto'

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

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

  /** Attaches a fresh presigned logo URL if the job has a stored logo key. */
  private async withLogoUrl<T extends { companyLogoKey?: string | null }>(job: T): Promise<T & { companyLogoUrl: string | null }> {
    const companyLogoUrl = job.companyLogoKey
      ? await this.s3.getPresignedDownloadUrl(job.companyLogoKey, 3600)
      : null
    return { ...job, companyLogoUrl }
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

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { postedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.job.count({ where }),
    ])

    const data = await Promise.all(rows.map((j) => this.withLogoUrl(j)))
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  async findOne(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { postedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
    if (!job) throw new NotFoundException('Job not found')
    return this.withLogoUrl(job)
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

  // ── Company Logo ─────────────────────────────────────────────

  /** Step 1 — returns a presigned PUT URL; browser uploads directly to S3. */
  async initiateLogoUpload(jobId: string, contentType: string) {
    await this.findOne(jobId)
    const logoId = randomUUID()
    const ext = contentType === 'image/png' ? '.png' : contentType === 'image/svg+xml' ? '.svg' : '.jpg'
    const key = `logos/job-${jobId}/${logoId}${ext}`
    const uploadUrl = await this.s3.getPresignedUploadUrl(key, contentType, 900)
    return { uploadUrl, logoKey: key }
  }

  /** Step 2 — stores the key after a successful S3 upload. Returns a view URL. */
  async confirmLogoUpload(jobId: string, logoKey: string) {
    await this.prisma.job.update({ where: { id: jobId }, data: { companyLogoKey: logoKey } })
    const logoUrl = await this.s3.getPresignedDownloadUrl(logoKey, 3600)
    return { logoUrl }
  }

  /** Fetch a fresh presigned GET URL for the logo. */
  async getLogoUrl(jobId: string) {
    const job = await this.findOne(jobId)
    if (!job.companyLogoKey) return { logoUrl: null }
    const logoUrl = await this.s3.getPresignedDownloadUrl(job.companyLogoKey, 3600)
    return { logoUrl }
  }

  /** Delete the logo from S3 and clear the key. */
  async deleteLogo(jobId: string) {
    const job = await this.findOne(jobId)
    if (job.companyLogoKey) {
      await this.s3.deleteFile(job.companyLogoKey)
      await this.prisma.job.update({ where: { id: jobId }, data: { companyLogoKey: null } })
    }
    return { message: 'Logo removed' }
  }
}
