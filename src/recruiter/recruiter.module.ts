import { Module } from '@nestjs/common'
import { RecruiterController } from './recruiter.controller'
import { RecruiterService } from './recruiter.service'
import { PrismaModule } from 'src/prisma/prisma.module'
import { S3Module } from 'src/s3/s3.module'

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [RecruiterController],
  providers: [RecruiterService],
})
export class RecruiterModule {}
