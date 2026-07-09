import { Module } from '@nestjs/common'
import { ManagerController } from './manager.controller'
import { ManagerService } from './manager.service'
import { PrismaModule } from 'src/prisma/prisma.module'
import { S3Module } from 'src/s3/s3.module'

@Module({
  imports: [PrismaModule, S3Module],
  controllers: [ManagerController],
  providers: [ManagerService],
})
export class ManagerModule {}
