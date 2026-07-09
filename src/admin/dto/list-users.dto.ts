import { IsOptional, IsString, IsEnum, IsInt, IsArray, Min } from 'class-validator'
import { Type, Transform } from 'class-transformer'
import { SubscriptionPlan, UserRole, VisaType } from '@prisma/client'

export class ListUsersDto {
  @IsOptional()
  @IsString()
  search?: string

  // Accepts ?skills=react&skills=typescript  OR a single ?skills=react
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : value ? [value] : undefined))
  @IsArray()
  @IsString({ each: true })
  skills?: string[]

  @IsOptional()
  @IsEnum(VisaType)
  visaType?: VisaType

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole

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
