import { IsString, IsIn, IsInt, Min, Max } from 'class-validator'

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export class InitiateResumeUploadDto {
  @IsString()
  originalName: string

  @IsIn(ALLOWED_CONTENT_TYPES, {
    message: `Invalid file type. Only PDF (.pdf) and Word (.doc, .docx) files are accepted.`,
  })
  contentType: string

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE, {
    message: `File too large. Maximum allowed size is 10 MB.`,
  })
  fileSize: number
}
