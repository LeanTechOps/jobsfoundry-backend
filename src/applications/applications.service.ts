import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from 'src/prisma/prisma.service'
import { S3Service } from 'src/s3/s3.service'
import { CreateApplicationDto } from './dto/create-application.dto'
import { UpdateApplicationDto } from './dto/update-application.dto'

const JOB_SELECT = {
  id: true, title: true, company: true, companyLogoKey: true,
  location: true, workMode: true, type: true, experienceLevel: true,
  salaryMin: true, salaryMax: true, salaryCurrency: true, salaryPeriod: true,
  salaryNegotiable: true, visaSponsorship: true, status: true,
}

const PROFILE_SELECT = {
  id: true,
  headline: true,
  skills: true,
  visaType: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
}

const RESUME_SELECT = {
  id: true, originalName: true, label: true, isDefault: true,
  thumbnailKey: true, key: true, contentType: true,
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────

  private async attachResumeUrl<T extends { resume?: { thumbnailKey?: string | null; key: string } | null }>(app: T) {
    if (!app.resume) return { ...app, resumeThumbnailUrl: null, resumeDownloadUrl: null }
    const [resumeThumbnailUrl, resumeDownloadUrl] = await Promise.all([
      app.resume.thumbnailKey ? this.s3.getPresignedDownloadUrl(app.resume.thumbnailKey, 3600) : null,
      this.s3.getPresignedDownloadUrl(app.resume.key, 3600),
    ])
    return { ...app, resumeThumbnailUrl, resumeDownloadUrl }
  }

  private async attachLogoUrl<T extends { job?: { companyLogoKey?: string | null } }>(app: T) {
    const key = app.job?.companyLogoKey
    const companyLogoUrl = key ? await this.s3.getPresignedDownloadUrl(key, 3600) : null
    return { ...app, companyLogoUrl }
  }

  /** Resolve the profile for a userId, throwing if not found */
  private async resolveProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } })
    if (!profile) throw new NotFoundException('User profile not found — the user must complete their profile first')
    return profile
  }

  // ── Admin: create application ─────────────────────────────

  async create(dto: CreateApplicationDto) {
    const [job, profile] = await Promise.all([
      this.prisma.job.findUnique({ where: { id: dto.jobId } }),
      this.resolveProfile(dto.userId),
    ])
    if (!job) throw new NotFoundException('Job not found')

    // Auto-pick default resume if none specified
    let resumeId = dto.resumeId
    if (!resumeId) {
      const defaultResume = await this.prisma.resume.findFirst({
        where: { profileId: profile.id, isDefault: true },
        select: { id: true },
      })
      resumeId = defaultResume?.id
    }

    try {
      const app = await this.prisma.jobApplication.create({
        data: {
          jobId: dto.jobId,
          profileId: profile.id,
          resumeId,
          notes: dto.notes,
          ...(dto.status && { status: dto.status }),
          ...(dto.interviewAt && { interviewAt: new Date(dto.interviewAt) }),
        },
        include: {
          job: { select: JOB_SELECT },
          profile: { select: PROFILE_SELECT },
          resume: { select: RESUME_SELECT },
        },
      })
      return this.attachResumeUrl(app)
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('User is already applied to this job')
      throw e
    }
  }

  // ── Admin: list applications for a job ───────────────────

  async findByJob(jobId: string) {
    const apps = await this.prisma.jobApplication.findMany({
      where: { jobId },
      orderBy: { appliedAt: 'desc' },
      include: {
        profile: { select: PROFILE_SELECT },
        resume: { select: RESUME_SELECT },
      },
    })
    return Promise.all(apps.map((a) => this.attachResumeUrl(a)))
  }

  // ── Admin: update status / notes / resume ────────────────

  async update(id: string, dto: UpdateApplicationDto) {
    const app = await this.prisma.jobApplication.findUnique({ where: { id } })
    if (!app) throw new NotFoundException('Application not found')
    const updated = await this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.resumeId !== undefined && { resumeId: dto.resumeId }),
        ...(dto.interviewAt !== undefined && {
          interviewAt: dto.interviewAt ? new Date(dto.interviewAt) : null,
        }),
      },
      include: {
        job: { select: JOB_SELECT },
        profile: { select: PROFILE_SELECT },
        resume: { select: RESUME_SELECT },
      },
    })
    return this.attachResumeUrl(updated)
  }

  // ── Admin: delete application ────────────────────────────

  async remove(id: string) {
    const app = await this.prisma.jobApplication.findUnique({ where: { id } })
    if (!app) throw new NotFoundException('Application not found')
    await this.prisma.jobApplication.delete({ where: { id } })
    return { message: 'Application removed' }
  }

  // ── User: my applications ────────────────────────────────

  async findMine(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { id: true } })
    if (!profile) return []   // no profile yet → no applications

    const apps = await this.prisma.jobApplication.findMany({
      where: { profileId: profile.id },
      orderBy: { appliedAt: 'desc' },
      include: { job: { select: JOB_SELECT }, resume: { select: RESUME_SELECT } },
    })

    return Promise.all(apps.map(async (a) => {
      const withResume = await this.attachResumeUrl(a)
      return this.attachLogoUrl(withResume)
    }))
  }
}
