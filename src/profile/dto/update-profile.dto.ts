import { IsOptional, IsString, IsUrl, IsArray, IsEnum, MaxLength } from 'class-validator'
import { VisaType } from '@prisma/client'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  headline?: string

  @IsOptional()
  @IsString()
  bio?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phoneNumber?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  linkedinUrl?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  githubUrl?: string

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  portfolioUrl?: string

  // Address
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string

  // Work authorization
  @IsOptional()
  @IsEnum(VisaType)
  visaType?: VisaType

  // Skills
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[]
}
