import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { Request } from 'express'
import { ResumeService } from './resume.service'
import { InitiateResumeUploadDto } from './dto/initiate-resume-upload.dto'
import { ConfirmResumeUploadDto } from './dto/confirm-resume-upload.dto'

@Controller('profile/resumes')
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  /** Step 1: get a presigned PUT URL — browser uploads directly to S3 */
  @Post('initiate-upload')
  initiateUpload(@Req() req: Request, @Body() dto: InitiateResumeUploadDto) {
    const userId = (req.user as any).id
    return this.resumeService.initiateUpload(userId, dto)
  }

  /** Step 2: confirm after browser finishes the direct S3 upload */
  @Post('confirm-upload')
  confirmUpload(@Req() req: Request, @Body() dto: ConfirmResumeUploadDto) {
    const userId = (req.user as any).id
    return this.resumeService.confirmUpload(userId, dto)
  }

  /** List all resumes — metadata only, no URLs generated */
  @Get()
  listResumes(@Req() req: Request) {
    const userId = (req.user as any).id
    return this.resumeService.listResumes(userId)
  }

  /** Lazy URL fetch — call this only when user needs to view/download a resume */
  @Get(':id/url')
  getResumeUrls(@Req() req: Request, @Param('id') resumeId: string) {
    const userId = (req.user as any).id
    return this.resumeService.getResumeUrls(userId, resumeId)
  }

  /** Mark a resume as the default */
  @Patch(':id/default')
  setDefault(@Req() req: Request, @Param('id') resumeId: string) {
    const userId = (req.user as any).id
    return this.resumeService.setDefault(userId, resumeId)
  }

  /** Delete a resume */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteResume(@Req() req: Request, @Param('id') resumeId: string) {
    const userId = (req.user as any).id
    return this.resumeService.deleteResume(userId, resumeId)
  }
}
