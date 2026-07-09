import { IsEnum, IsOptional, IsString, IsDateString, IsUUID } from 'class-validator'
import { ApplicationStatus } from '@prisma/client'

export class UpdateApplicationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus

  @IsOptional()
  @IsDateString()
  interviewAt?: string

  @IsOptional()
  @IsString()
  notes?: string

  @IsOptional()
  @IsUUID()
  resumeId?: string
}
