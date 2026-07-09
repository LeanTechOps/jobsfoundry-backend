import { Module } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { JobsController } from './jobs.controller'
import { PrismaModule } from 'src/prisma/prisma.module'
import { S3Module } from 'src/s3/s3.module'

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
