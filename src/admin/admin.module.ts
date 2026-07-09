import { Module } from '@nestjs/common'
import { AdminService } from './admin.service'
import { AdminController } from './admin.controller'
import { PrismaModule } from 'src/prisma/prisma.module'
import { S3Module } from 'src/s3/s3.module'

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
