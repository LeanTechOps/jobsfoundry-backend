import { Module } from '@nestjs/common'
import { ProfileController } from './profile.controller'
import { ProfileService } from './profile.service'
import { ResumeController } from './resume.controller'
import { ResumeService } from './resume.service'
import { ThumbnailService } from './thumbnail.service'
import { S3Module } from '../s3/s3.module'

@Module({
  imports: [S3Module],
  controllers: [ProfileController, ResumeController],
  providers: [ProfileService, ResumeService, ThumbnailService],
  exports: [ProfileService, ResumeService],
})
export class ProfileModule {}
