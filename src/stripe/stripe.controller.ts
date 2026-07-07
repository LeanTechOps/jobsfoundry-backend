import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  BadRequestException,
  Headers,
  RawBodyRequest,
  Req,
} from '@nestjs/common'
import { StripeService } from './stripe.service'
import { StripeWebhookService } from './stripe-webhook.service'
import { CreateCheckoutDto } from './dto/create-checkout.dto'
import { Public } from '../auth/decorator/public.decorator'

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly webhookService: StripeWebhookService,
  ) {}

  @Get('pricing')
  @Public()
  async getPricing() {
    return this.stripeService.getPricingPlans()
  }

  @Get('subscription-status')
  async getSubscriptionStatus(@Request() req) {
    return this.stripeService.getSubscriptionStatus(req.user.id)
  }

  @Post('create-subscription-session')
  async createSubscriptionSession(@Body() dto: CreateCheckoutDto, @Request() req) {
    return this.stripeService.createSubscriptionSession(req.user.id, dto.stripePriceId, dto.flowType)
  }

  @Post('webhook')
  @Public()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.webhookService.handleWebhook(signature, (req as any).rawBody)
  }
}
