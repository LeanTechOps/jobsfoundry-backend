import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class ConfirmResumeUploadDto {
  @IsUUID()
  resumeId: string

  @IsString()
  originalName: string

  @IsString()
  contentType: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string
}
