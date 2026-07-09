import { IsString, IsOptional, IsUUID, IsEnum, IsDateString } from 'class-validator'
import { ApplicationStatus } from '@prisma/client'

export class CreateApplicationDto {
  @IsUUID()
  jobId: string

  /** Admin selects a user — the service resolves their profile internally */
  @IsUUID()
  userId: string

  @IsOptional()
  @IsUUID()
  resumeId?: string

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus

  @IsOptional()
  @IsDateString()
  interviewAt?: string

  @IsOptional()
  @IsString()
  notes?: string
}
