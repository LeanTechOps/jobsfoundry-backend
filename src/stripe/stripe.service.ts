import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SubscriptionPlan } from '@prisma/client'
import Stripe from 'stripe'
import { PrismaService } from '../prisma/prisma.service'
import { PricingPlan } from './dto/pricing.dto'
import { PRICING_FEATURES } from './pricing-features.config'
import {
  mapStripeStatus,
  mapStripePlanToPrisma,
  resolveStripeCustomer,
} from './utils/stripe.utils'

const TRIAL_PERIOD_DAYS = 15

@Injectable()
export class StripeService {
  private stripe: Stripe
  private readonly logger = new Logger(StripeService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY')
    if (!apiKey) throw new Error('STRIPE_SECRET_KEY not configured')

    this.stripe = new Stripe(apiKey, {
      apiVersion: '2025-12-15.clover' as any,
    })
  }

  // ─── Trial setup (called at signup) ────────────────────────────────────────

  /**
   * Creates a Stripe customer (find-or-create by email) and a FREE-plan trial
   * subscription with trial_period_days=15. Stripe will fire
   * customer.subscription.updated when the trial transitions to active,
   * giving us automatic expiry handling via webhooks.
   *
   * If a subscription already exists for this customer (re-login case), we
   * sync it to DB and return without creating a duplicate.
   */
  async createTrialSubscription(
    userId: string,
    email: string,
    name?: string,
  ): Promise<{ stripeCustomerId: string; stripeSubscriptionId: string }> {
    // 1. Find or create Stripe customer by email
    const customerId = await resolveStripeCustomer(this.stripe, this.prisma, {
      userId,
      email,
      name,
      logPrefix: '[TRIAL] ',
      logger: this.logger,
    })

    // 2. Check if this customer already has a Stripe subscription (re-login / env re-use)
    this.logger.log(`[TRIAL] Checking existing subscriptions for customer=${customerId} userId=${userId}`)
    const existing = await this.stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      expand: ['data.items.data.price'],
    })

    this.logger.log(`[TRIAL] Found ${existing.data.length} existing subscription(s) for customer=${customerId}`)

    if (existing.data.length > 0) {
      const sub = existing.data[0]
      this.logger.warn(
        `[TRIAL] Customer ${customerId} already has subscription ${sub.id} (status=${sub.status}) — syncing to DB instead of creating new`,
      )

      // Ensure metadata carries userId so future webhooks can look up the record
      if (sub.metadata?.userId !== userId) {
        this.logger.log(`[TRIAL] Updating subscription ${sub.id} metadata: userId=${userId}`)
        try {
          await this.stripe.subscriptions.update(sub.id, { metadata: { userId } })
        } catch (err) {
          this.logger.warn(`[TRIAL] Could not update subscription metadata: ${err.message}`)
        }
      } else {
        this.logger.log(`[TRIAL] Subscription ${sub.id} metadata already has correct userId — skipping update`)
      }

      const productId = sub.items.data[0]?.price?.product as string | undefined
      this.logger.log(`[TRIAL] Resolving product name for productId=${productId ?? 'none'}`)
      let planKey: string | undefined
      if (productId) {
        try {
          const product = await this.stripe.products.retrieve(productId)
          planKey = product.name?.toUpperCase()
          this.logger.log(`[TRIAL] Resolved product name="${product.name}" → planKey="${planKey}"`)
        } catch (err) {
          this.logger.warn(`[TRIAL] Could not retrieve product ${productId}: ${err.message}`)
        }
      }

      const subAny = sub as any
      // A FREE-priced subscription in trialing state = PRO_FREE trial in our DB
      const mappedPlan = mapStripePlanToPrisma(planKey) ?? SubscriptionPlan.FORGE
      const plan =
        sub.status === 'trialing' && mappedPlan === SubscriptionPlan.FORGE
          ? SubscriptionPlan.FORGE_FREE
          : mappedPlan
      const interval = sub.items.data[0]?.price?.recurring?.interval
      const billingCycle: 'MONTHLY' | 'YEARLY' = interval === 'year' ? 'YEARLY' : 'MONTHLY'
      const trialEnd: number | null = subAny.trial_end ?? null

      this.logger.log(
        `[TRIAL] Syncing to DB: plan=${plan}, status=${sub.status}, billingCycle=${billingCycle}, trialEnd=${trialEnd ? new Date(trialEnd * 1000).toISOString() : 'none'}`,
      )

      await this.prisma.subscription.update({
        where: { userId },
        data: {
          stripeSubscriptionId: sub.id,
          stripeCustomerId: customerId,
          plan,
          status: mapStripeStatus(sub.status),
          billingCycle,
          currentPeriodStart: subAny.current_period_start
            ? new Date(subAny.current_period_start * 1000)
            : null,
          currentPeriodEnd: trialEnd
            ? new Date(trialEnd * 1000)
            : subAny.current_period_end
              ? new Date(subAny.current_period_end * 1000)
              : null,
          currentPrice: (sub.items.data[0]?.price?.unit_amount ?? 0) / 100,
          cancelAt: subAny.cancel_at ? new Date(subAny.cancel_at * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      })

      this.logger.log(`[TRIAL] DB sync complete for userId=${userId}, subscriptionId=${sub.id}`)
      return { stripeCustomerId: customerId, stripeSubscriptionId: sub.id }
    }

    // 3. Find the FORGE price (unit_amount = 0) in Stripe
    this.logger.log(`[TRIAL] No existing subscription — searching for FORGE price (unit_amount=0) in Stripe`)
    const prices = await this.stripe.prices.list({ active: true, expand: ['data.product'] })
    this.logger.log(`[TRIAL] Fetched ${prices.data.length} active price(s) from Stripe`)

    const freePrice = prices.data.find((p) => {
      const product = p.product as Stripe.Product
      return product?.name?.toUpperCase() === 'FORGE' && p.unit_amount === 0
    })

    if (!freePrice) {
      this.logger.warn(
        `[TRIAL] FORGE price not found among ${prices.data.length} active prices — ` +
        `products seen: [${prices.data.map((p) => (p.product as Stripe.Product)?.name ?? 'unknown').join(', ')}]. ` +
        'Create a FORGE product (price = $0/month) in Stripe to enable automatic trial expiry.',
      )
      const trialEndsAt = new Date()
      trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS)
      await this.prisma.subscription.update({
        where: { userId },
        data: {
          stripeCustomerId: customerId,
          plan: SubscriptionPlan.FORGE_FREE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: trialEndsAt,
        },
      })
      this.logger.log(`[TRIAL] DB-only trial set for userId=${userId} plan=FORGE_FREE ends=${trialEndsAt.toISOString()}`)
      return { stripeCustomerId: customerId, stripeSubscriptionId: '' }
    }

    this.logger.log(`[TRIAL] Found FORGE price ${freePrice.id} — creating ${TRIAL_PERIOD_DAYS}-day trial for userId=${userId}`)

    // 4. Create the trial subscription on the FORGE product
    const stripeSub = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: freePrice.id }],
      trial_period_days: TRIAL_PERIOD_DAYS,
      payment_behavior: 'default_incomplete',
      metadata: { userId },
    })

    const subAny = stripeSub as any
    const trialEnd: number | null = subAny.trial_end ?? null

    this.logger.log(
      `[TRIAL] Subscription ${stripeSub.id} created — status=${stripeSub.status}, trial_end=${trialEnd ? new Date(trialEnd * 1000).toISOString() : 'none'}`,
    )

    // 5. Persist IDs, FORGE_FREE plan, and trial period to DB
    await this.prisma.subscription.update({
      where: { userId },
      data: {
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId: customerId,
        plan: SubscriptionPlan.FORGE_FREE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd ? new Date(trialEnd * 1000) : null,
      },
    })

    this.logger.log(`[TRIAL] DB updated: userId=${userId} subscription=${stripeSub.id} plan=FORGE_FREE`)
    return { stripeCustomerId: customerId, stripeSubscriptionId: stripeSub.id }
  }

  async getPricingPlans(): Promise<PricingPlan[]> {
    try {
      const prices = await this.stripe.prices.list({
        active: true,
        expand: ['data.product'],
      })

      const plans: PricingPlan[] = []

      for (const price of prices.data) {
        const product = price.product as Stripe.Product
        const planName = product?.name
        const planKey = planName?.toUpperCase()
        const planConfig = PRICING_FEATURES[planKey]

        if (!planConfig) continue

        plans.push({
          id: planKey.toLowerCase(),
          name: planName,
          description: product.description || `${planName} plan`,
          price: (price.unit_amount || 0) / 100,
          currency: price.currency,
          interval: price.recurring?.interval || 'month',
          stripePriceId: price.id,
          stripeProductId: product.id,
          popular: planConfig.popular,
          features: planConfig.features,
        })
      }

      plans.sort((a, b) => a.price - b.price)
      return plans
    } catch (error) {
      this.logger.error('Error fetching pricing from Stripe:', error)
      throw new BadRequestException('Failed to fetch pricing plans')
    }
  }

  async createCheckoutSessionByPriceId(
    userId: string,
    stripePriceId: string,
  ): Promise<Stripe.Checkout.Session> {
    try {
      const subscription = await this.prisma.subscription.findUnique({
        where: { userId },
        select: {
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      })

      if (!subscription) throw new BadRequestException('No subscription found')

      const userName = [subscription.user.firstName, subscription.user.lastName]
        .filter(Boolean)
        .join(' ')

      let customerId = subscription.stripeCustomerId

      if (!customerId) {
        customerId = await resolveStripeCustomer(this.stripe, this.prisma, {
          userId,
          email: subscription.user.email,
          name: userName || undefined,
          logger: this.logger,
        })
      }

      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4000')

      this.logger.log(
        `[CHECKOUT] Creating session for userId=${userId} priceId=${stripePriceId} ` +
        `oldSubscriptionId=${subscription.stripeSubscriptionId ?? 'none'}`,
      )

      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: stripePriceId, quantity: 1 }],
        customer_update: { address: 'auto' },
        success_url: `${frontendUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/pricing`,
        subscription_data: { metadata: { userId } },
        metadata: {
          userId,
          // Embedded so the webhook can cancel the old trial sub even on retries
          // (on retry the DB already shows the new sub ID, so we can't read it from there)
          ...(subscription.stripeSubscriptionId && {
            oldSubscriptionId: subscription.stripeSubscriptionId,
          }),
        },
      })

      return session
    } catch (error) {
      this.logger.error('Error creating checkout session:', error)
      if (error instanceof BadRequestException) throw error
      throw new BadRequestException('Failed to create checkout session')
    }
  }

  async createSubscriptionSession(
    userId: string,
    stripePriceId?: string,
    flowType?: 'subscription_update',
  ): Promise<{ url: string; type: 'checkout' | 'portal' }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      select: {
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        plan: true,
        status: true,
      },
    })

    if (!subscription) throw new BadRequestException('No subscription found')

    // Use checkout for: FREE or PRO_FREE (trial) users.
    // PRO_FREE = active trial → checkout creates a new paid subscription.
    // FREE = trial expired or never started → same path.
    // Portal is only for users who already have an active paid subscription.
    const isActivePaidSub =
      subscription.plan !== SubscriptionPlan.FORGE &&
      subscription.plan !== SubscriptionPlan.FORGE_FREE &&
      !!subscription.stripeSubscriptionId

    if (!isActivePaidSub) {
      if (!stripePriceId) throw new BadRequestException('Price ID required for new subscriptions')
      const session = await this.createCheckoutSessionByPriceId(userId, stripePriceId)
      return { url: session.url ?? '', type: 'checkout' }
    }

    if (!subscription.stripeCustomerId) throw new BadRequestException('No Stripe customer found')

    const portalSession = await this.createPortalSession(
      subscription.stripeCustomerId,
      subscription.stripeSubscriptionId,
      flowType,
    )
    return { url: portalSession.url, type: 'portal' }
  }

  async createPortalSession(
    stripeCustomerId: string,
    stripeSubscriptionId: string | null,
    flowType?: 'subscription_update',
  ): Promise<{ url: string }> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4000')

    const config: Stripe.BillingPortal.SessionCreateParams = {
      customer: stripeCustomerId,
      return_url: `${frontendUrl}/dashboard`,
    }

    if (flowType === 'subscription_update' && stripeSubscriptionId) {
      config.flow_data = {
        type: 'subscription_update',
        subscription_update: { subscription: stripeSubscriptionId },
      }
    }

    const session = await this.stripe.billingPortal.sessions.create(config)
    return { url: session.url }
  }

  async getSubscriptionStatus(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      select: {
        id: true,
        plan: true,
        status: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
        billingCycle: true,
        cancelAtPeriodEnd: true,
      },
    })

    if (!subscription) return null

    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      stripeCustomerId: subscription.stripeCustomerId,
      billingCycle: subscription.billingCycle,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    }
  }
}
