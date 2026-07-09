import { Module } from '@nestjs/common'
import { ApplicationsService } from './applications.service'
import { ApplicationsController } from './applications.controller'
import { PrismaModule } from 'src/prisma/prisma.module'
import { S3Module } from 'src/s3/s3.module'

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
