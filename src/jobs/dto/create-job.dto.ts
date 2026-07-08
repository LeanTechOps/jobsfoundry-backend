import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsNumber, IsDateString, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ExperienceLevel, JobStatus, JobType, SalaryPeriod, WorkMode } from '@prisma/client'

export class CreateJobDto {
  @IsString()
  title: string

  @IsString()
  company: string

  @IsOptional()
  @IsString()
  companyDomain?: string

  @IsOptional()
  @IsString()
  location?: string

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode

  @IsOptional()
  @IsEnum(JobType)
  type?: JobType

  @IsOptional()
  @IsEnum(ExperienceLevel)
  experienceLevel?: ExperienceLevel

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus

  @IsString()
  description: string

  @IsOptional()
  @IsString()
  responsibilities?: string

  @IsOptional()
  @IsString()
  requirements?: string

  @IsOptional()
  @IsString()
  benefits?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[]

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  salaryMin?: number

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  salaryMax?: number

  @IsOptional()
  @IsString()
  salaryCurrency?: string

  @IsOptional()
  @IsEnum(SalaryPeriod)
  salaryPeriod?: SalaryPeriod

  @IsOptional()
  @IsBoolean()
  salaryNegotiable?: boolean

  @IsOptional()
  @IsBoolean()
  visaSponsorship?: boolean

  @IsOptional()
  @IsString()
  applicationUrl?: string

  @IsOptional()
  @IsDateString()
  closesAt?: string
}
