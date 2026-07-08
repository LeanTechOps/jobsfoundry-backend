import { IsOptional, IsString, IsEnum, IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { SubscriptionPlan, VisaType } from '@prisma/client'

export class ListUsersDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  skill?: string

  @IsOptional()
  @IsEnum(VisaType)
  visaType?: VisaType

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  plan?: SubscriptionPlan

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
