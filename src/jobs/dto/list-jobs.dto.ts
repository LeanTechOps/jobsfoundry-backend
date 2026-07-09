import { IsOptional, IsEnum, IsString, IsBoolean, IsInt, Min } from 'class-validator'
import { Type, Transform } from 'class-transformer'
import { ExperienceLevel, JobStatus, JobType, WorkMode } from '@prisma/client'

export class ListJobsDto {
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus

  @IsOptional()
  @IsEnum(JobType)
  type?: JobType

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode

  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  skill?: string

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  visaSponsorship?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20
}
