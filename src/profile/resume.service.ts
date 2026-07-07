import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { S3Service } from '../s3/s3.service'
import { ThumbnailService } from './thumbnail.service'
import { InitiateResumeUploadDto } from './dto/initiate-resume-upload.dto'
import { ConfirmResumeUploadDto } from './dto/confirm-resume-upload.dto'
import * as path from 'path'
import { randomUUID } from 'crypto'

const CONTENT_TYPE_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
}

@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  private async getProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } })
    if (!profile) throw new NotFoundException('Profile not found. Visit /profile first to initialise it.')
    return profile
  }

  /**
   * Step 1 — returns a presigned PUT URL.
   * Browser uploads the file directly to S3 using this URL; no file bytes touch the backend.
   */
  async initiateUpload(userId: string, dto: InitiateResumeUploadDto) {
    this.logger.log(`[initiateUpload] start — userId=${userId} file="${dto.originalName}" type=${dto.contentType} size=${dto.fileSize}`)

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!user) throw new NotFoundException('User not found')

    const resumeId = randomUUID()
    const ext = CONTENT_TYPE_EXT[dto.contentType] ||
      path.extname(dto.originalName).toLowerCase() || '.pdf'

    const key = this.s3.buildResumeKey(user.email, resumeId, ext)
    this.logger.log(`[initiateUpload] key=${key}`)

    const uploadUrl = await this.s3.getPresignedUploadUrl(key, dto.contentType)
    this.logger.log(`[initiateUpload] presigned URL ready — resumeId=${resumeId}`)

    return { resumeId, key, uploadUrl, expiresIn: 900 }
  }

  /**
   * Step 2 — called after browser finishes the direct S3 upload.
   * Saves the Resume record, then generates a thumbnail in the background.
   */
  async confirmUpload(userId: string, dto: ConfirmResumeUploadDto) {
    this.logger.log(`[confirmUpload] start — userId=${userId} resumeId=${dto.resumeId} file="${dto.originalName}"`)

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    if (!user) throw new NotFoundException('User not found')

    const profile = await this.getProfile(userId)
    this.logger.log(`[confirmUpload] profile found — profileId=${profile.id}`)

    const ext = CONTENT_TYPE_EXT[dto.contentType] ||
      path.extname(dto.originalName).toLowerCase() || '.pdf'

    const key = this.s3.buildResumeKey(user.email, dto.resumeId, ext)
    const existingCount = await this.prisma.resume.count({ where: { profileId: profile.id } })

    let resume = await this.prisma.resume.create({
      data: {
        id: dto.resumeId,
        profileId: profile.id,
        key,
        originalName: dto.originalName,
        label: dto.label ?? null,
        contentType: dto.contentType,
        isDefault: existingCount === 0,
      },
    })

    // Generate thumbnail synchronously — adds ~300-500ms but browser gets a complete
    // record with thumbnailKey already populated. Uploads are infrequent so the wait is fine.
    this.logger.log(`[confirmUpload] resume record saved — id=${resume.id}`)

    try {
      this.logger.log(`[confirmUpload] generating thumbnail for key=${key}`)
      resume = await this.generateAndSaveThumbnail(resume.id, key, user.email, dto.resumeId)
      this.logger.log(`[confirmUpload] thumbnail done`)
    } catch (err) {
      this.logger.warn(`[confirmUpload] thumbnail generation failed (non-fatal): ${err.message}`)
    }

    this.logger.log(`[confirmUpload] done — resumeId=${resume.id} thumbnailKey=${resume.thumbnailKey ?? 'none'}`)
    return resume
  }

  private async generateAndSaveThumbnail(
    resumeId: string,
    pdfKey: string,
    email: string,
    id: string,
  ) {
    const pdfBuffer = await this.s3.getObject(pdfKey)
    const thumbnailBuffer = await this.thumbnailService.generateFromPdfBuffer(pdfBuffer)

    const thumbnailKey = this.s3.buildResumeKey(email, id, '-thumb.png')
    await this.s3.uploadFile(thumbnailKey, thumbnailBuffer, this.thumbnailService.contentType)

    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: { thumbnailKey },
    })

    this.logger.log(`Thumbnail saved for resume ${resumeId}: ${thumbnailKey}`)
    return updated
  }

  /** Returns resume list with metadata only — no presigned URLs generated here */
  async listResumes(userId: string) {
    const profile = await this.getProfile(userId)

    return this.prisma.resume.findMany({
      where: { profileId: profile.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        originalName: true,
        label: true,
        contentType: true,
        isDefault: true,
        thumbnailKey: true,
        createdAt: true,
      },
    })
  }

  /** Lazy URL fetch — called only when user needs to view/download a specific resume */
  async getResumeUrls(userId: string, resumeId: string) {
    const resume = await this.assertOwnership(userId, resumeId)

    const [downloadUrl, thumbnailUrl] = await Promise.all([
      this.s3.getPresignedDownloadUrl(resume.key),
      resume.thumbnailKey
        ? this.s3.getPresignedDownloadUrl(resume.thumbnailKey)
        : Promise.resolve(null),
    ])

    return { downloadUrl, thumbnailUrl }
  }

  async setDefault(userId: string, resumeId: string) {
    const resume = await this.assertOwnership(userId, resumeId)

    await this.prisma.$transaction([
      this.prisma.resume.updateMany({
        where: { profileId: resume.profileId },
        data: { isDefault: false },
      }),
      this.prisma.resume.update({
        where: { id: resumeId },
        data: { isDefault: true },
      }),
    ])

    return this.prisma.resume.findUnique({ where: { id: resumeId } })
  }

  async deleteResume(userId: string, resumeId: string) {
    const resume = await this.assertOwnership(userId, resumeId)

    // Delete PDF + thumbnail from S3 in parallel
    await Promise.all([
      this.s3.deleteFile(resume.key),
      resume.thumbnailKey ? this.s3.deleteFile(resume.thumbnailKey) : Promise.resolve(),
    ])

    await this.prisma.resume.delete({ where: { id: resumeId } })

    if (resume.isDefault) {
      const next = await this.prisma.resume.findFirst({
        where: { profileId: resume.profileId },
        orderBy: { createdAt: 'desc' },
      })
      if (next) {
        await this.prisma.resume.update({
          where: { id: next.id },
          data: { isDefault: true },
        })
      }
    }

    return { message: 'Resume deleted successfully' }
  }

  private async assertOwnership(userId: string, resumeId: string) {
    const profile = await this.getProfile(userId)
    const resume = await this.prisma.resume.findUnique({ where: { id: resumeId } })
    if (!resume) throw new NotFoundException('Resume not found')
    if (resume.profileId !== profile.id) throw new ForbiddenException()
    return resume
  }
}
