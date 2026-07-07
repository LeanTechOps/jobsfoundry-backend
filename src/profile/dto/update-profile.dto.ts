import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator'

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
}
