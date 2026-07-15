import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SubscriptionPlan, SubscriptionEventType } from '@prisma/client'
import Stripe from 'stripe'
import { PrismaService } from '../prisma/prisma.service'
import {
  mapStripeStatus,
  mapStripePlanToPrisma,
  extractSubscriptionIdFromInvoice,
  extractSubscriptionIdFromSession,
} from './utils/stripe.utils'

const PLAN_ORDER: Record<string, number> = {
  FORGE: 0,
  FORGE_FREE: 1,
  CRAFT: 2,
  LAUNCH: 3,
  MOMENTUM: 4,
}

@Injectable()
export class StripeWebhookService {
  private stripe: Stripe
  private readonly logger = new Logger(StripeWebhookService.name)

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

  async handleWebhook(signature: string, rawBody: Buffer) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET')
    if (!webhookSecret) throw new BadRequestException('Webhook secret not configured')

    let event: Stripe.Event
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`)
      throw new BadRequestException('Invalid signature')
    }

    const { alreadyProcessed } = await this.logWebhookEvent(event)
    if (alreadyProcessed) {
      this.logger.log(`Skipping already processed webhook event ${event.id}`)
      return { received: true, alreadyProcessed: true }
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
          break
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
          break
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
          break
        case 'invoice.finalized':
          await this.handleInvoiceFinalized(event.data.object as Stripe.Invoice)
          break
        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice)
          break
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
          break
        case 'invoice.voided':
          await this.handleInvoiceVoided(event.data.object as Stripe.Invoice)
          break
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
          break
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
          break
        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent)
          break
        case 'charge.refunded':
          await this.handleChargeRefunded(event.data.object as Stripe.Charge)
          break
        default:
          this.logger.log(`Unhandled event type: ${event.type}`)
      }

      await this.markWebhookProcessed(event.id)
      return { received: true }
    } catch (error) {
      this.logger.error(`Error processing webhook ${event.id}: ${error.message}`)
      await this.markWebhookError(event.id, error.message)
      throw error
    }
  }

  // ─── Idempotency helpers ────────────────────────────────────────────────────

  private async logWebhookEvent(event: Stripe.Event): Promise<{ alreadyProcessed: boolean }> {
    const existing = await this.prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    })

    if (existing) {
      return { alreadyProcessed: existing.processed }
    }

    await this.prisma.stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
        apiVersion: event.api_version,
        data: event.data as any,
        processed: false,
      },
    })

    return { alreadyProcessed: false }
  }

  private async markWebhookProcessed(eventId: string) {
    await this.prisma.stripeWebhookEvent.update({
      where: { stripeEventId: eventId },
      data: { processed: true, processedAt: new Date() },
    })
  }

  private async markWebhookError(eventId: string, error: string) {
    await this.prisma.stripeWebhookEvent.update({
      where: { stripeEventId: eventId },
      data: { processingError: error, retryCount: { increment: 1 } },
    })
  }

  // ─── Event handlers ─────────────────────────────────────────────────────────

  /**
   * checkout.session.completed
   * Link the new Stripe subscription ID; cancel the old one (if any).
   */
  private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId
    if (!userId) throw new Error('Missing userId in checkout session metadata')

    const newSubscriptionId = extractSubscriptionIdFromSession(session)
    if (!newSubscriptionId) throw new Error('Missing subscription ID in checkout session')

    this.logger.log(
      `[CHECKOUT] session=${session.id} userId=${userId} newSubscriptionId=${newSubscriptionId}`,
    )

    const subscription = await this.prisma.subscription.findUnique({ where: { userId } })
    if (!subscription) throw new Error(`Subscription not found for user ${userId}`)

    // Prefer oldSubscriptionId from session metadata — on webhook retries the DB has
    // already been updated to newSubscriptionId, so reading from DB gives the wrong value
    // and the old trial sub would never be canceled.
    const oldSubscriptionId =
      session.metadata?.oldSubscriptionId ?? subscription.stripeSubscriptionId

    this.logger.log(
      `[CHECKOUT] oldSubscriptionId=${oldSubscriptionId ?? 'none'} (source=${session.metadata?.oldSubscriptionId ? 'metadata' : 'db'}) currentDbId=${subscription.stripeSubscriptionId ?? 'none'}`,
    )

    // Update DB first so the deletion webhook for the old sub ignores it
    await this.prisma.subscription.update({
      where: { userId },
      data: { stripeSubscriptionId: newSubscriptionId },
    })
    this.logger.log(`[CHECKOUT] DB updated stripeSubscriptionId=${newSubscriptionId} for userId=${userId}`)

    if (oldSubscriptionId && oldSubscriptionId !== newSubscriptionId) {
      this.logger.log(`[CHECKOUT] Canceling old subscription ${oldSubscriptionId} for userId=${userId}`)
      try {
        await this.stripe.subscriptions.cancel(oldSubscriptionId, {
          prorate: false,
          invoice_now: false,
        })
        this.logger.log(`[CHECKOUT] Canceled old subscription ${oldSubscriptionId} for userId=${userId}`)
      } catch (error) {
        // Non-fatal — log and continue; re-throwing would cause a retry where DB already
        // shows newSubscriptionId, making the old sub impossible to cancel via webhook.
        this.logger.warn(`[CHECKOUT] Could not cancel old subscription ${oldSubscriptionId}: ${error.message}`)
      }
    } else {
      this.logger.log(`[CHECKOUT] No old subscription to cancel (old=${oldSubscriptionId ?? 'none'} new=${newSubscriptionId})`)
    }
  }

  /**
   * customer.subscription.created / updated
   * Sync plan, status, billing period and price from Stripe to DB.
   */
  private async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
    const userId = stripeSubscription.metadata?.userId
    if (!userId) {
      this.logger.warn(`Subscription ${stripeSubscription.id} has no userId in metadata — skipping`)
      return
    }

    this.logger.log(
      `[SUB_UPDATED] subId=${stripeSubscription.id} status=${stripeSubscription.status} userId=${userId}`,
    )

    const subscription = await this.prisma.subscription.findUnique({ where: { userId } })
    if (!subscription) throw new Error(`Subscription not found for user ${userId}`)

    // Ignore canceled events for subscriptions that are no longer in our DB.
    // This guards against the old-trial-canceled webhook after checkout.session.completed
    // has already swapped in the new subscription ID.
    if (
      stripeSubscription.status === 'canceled' &&
      subscription.stripeSubscriptionId !== stripeSubscription.id
    ) {
      this.logger.log(
        `[SUB_UPDATED] Ignoring canceled event for stale subscription ${stripeSubscription.id} ` +
          `(current: ${subscription.stripeSubscriptionId ?? 'none'})`,
      )
      return
    }

    // For trialing subscriptions: sync IDs, set plan=FORGE_FREE so we can distinguish
    // from an actual FORGE plan. Stripe fires another event when trial converts to active.
    if (stripeSubscription.status === 'trialing') {
      const subAny = stripeSubscription as any
      const trialEnd: number | null = subAny.trial_end ?? null
      const customerId =
        typeof stripeSubscription.customer === 'string'
          ? stripeSubscription.customer
          : (stripeSubscription.customer as Stripe.Customer | null)?.id ?? null

      this.logger.log(
        `[SUB_UPDATED] Trial subscription — setting plan=FORGE_FREE, trialEnd=${trialEnd ? new Date(trialEnd * 1000).toISOString() : 'none'}`,
      )

      await this.prisma.subscription.update({
        where: { userId },
        data: {
          stripeSubscriptionId: stripeSubscription.id,
          plan: SubscriptionPlan.FORGE_FREE,
          ...(customerId && { stripeCustomerId: customerId }),
          currentPeriodStart: new Date(stripeSubscription.created * 1000),
          ...(trialEnd && { currentPeriodEnd: new Date(trialEnd * 1000) }),
        },
      })
      this.logger.log(`[SUB_UPDATED] Synced trial subscription ${stripeSubscription.id} → FORGE_FREE for userId=${userId}`)
      return
    }

    // Resolve plan from Stripe product name
    const productId = stripeSubscription.items.data[0]?.price?.product as string | undefined
    let planName: string | undefined

    this.logger.log(`[SUB_UPDATED] Resolving product productId=${productId ?? 'none'}`)
    if (productId) {
      try {
        const product = await this.stripe.products.retrieve(productId)
        planName = product.name
        this.logger.log(`[SUB_UPDATED] Resolved product name="${planName}"`)
      } catch (error) {
        throw new Error(`Cannot process subscription without product info: ${error.message}`)
      }
    }

    const planKey = planName?.toUpperCase()
    const plan =
      (planKey ? mapStripePlanToPrisma(planKey, subscription.plan) : subscription.plan) ??
      subscription.plan

    this.logger.log(
      `[SUB_UPDATED] planKey=${planKey ?? 'none'} resolvedPlan=${plan} oldPlan=${subscription.plan} status=${stripeSubscription.status}`,
    )

    const interval = stripeSubscription.items.data[0]?.price?.recurring?.interval
    const billingCycle: 'MONTHLY' | 'YEARLY' = interval === 'year' ? 'YEARLY' : 'MONTHLY'

    // Use top-level period fields from the subscription object.
    // Cast to any because these fields exist in the API response but the TS types
    // for the clover API version may not expose them yet.
    const subAny = stripeSubscription as any
    const currentPeriodStart = subAny.current_period_start
      ? new Date(subAny.current_period_start * 1000)
      : new Date(stripeSubscription.created * 1000)
    const currentPeriodEnd = subAny.current_period_end
      ? new Date(subAny.current_period_end * 1000)
      : (() => {
          const d = new Date(currentPeriodStart)
          interval === 'year' ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1)
          return d
        })()

    const newStatus = mapStripeStatus(stripeSubscription.status)
    const cancelAt = stripeSubscription.cancel_at
      ? new Date(stripeSubscription.cancel_at * 1000)
      : null

    const oldStatus = subscription.status
    const planChanged = subscription.plan !== plan
    const statusChanged = oldStatus !== newStatus
    const billingCycleChanged = subscription.billingCycle !== billingCycle
    const shouldCreateHistory = planChanged || statusChanged || billingCycleChanged

    await this.prisma.subscription.update({
      where: { userId },
      data: {
        status: newStatus,
        plan,
        stripeSubscriptionId: stripeSubscription.id,
        subscriptionStartedAt: subscription.subscriptionStartedAt ?? currentPeriodStart,
        currentPeriodStart,
        currentPeriodEnd,
        billingCycle,
        currentPrice: (stripeSubscription.items.data[0]?.price?.unit_amount ?? 0) / 100,
        cancelAt,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    })

    if (shouldCreateHistory) {
      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          eventType: this.resolveSubscriptionEventType(
            subscription.plan,
            plan,
            oldStatus,
            newStatus,
          ),
          oldStatus,
          newStatus,
          oldPlan: subscription.plan,
          newPlan: plan,
          description: this.buildChangeDescription(
            subscription.plan,
            plan,
            oldStatus,
            newStatus,
            billingCycle,
            subscription.billingCycle,
          ),
        },
      })
    }
  }

  /**
   * customer.subscription.deleted
   * Stripe subscription was hard-deleted → downgrade to FREE.
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
    const userId = stripeSubscription.metadata?.userId
    if (!userId) {
      this.logger.warn(`Deleted subscription ${stripeSubscription.id} has no userId — skipping`)
      return
    }

    const subscription = await this.prisma.subscription.findUnique({ where: { userId } })
    if (!subscription) throw new Error(`Subscription not found for user ${userId}`)

    // Guard: only act if this is still the active subscription in our DB
    if (subscription.stripeSubscriptionId !== stripeSubscription.id) {
      this.logger.log(
        `Ignoring deletion of old subscription ${stripeSubscription.id} — current is ${subscription.stripeSubscriptionId ?? 'none'}`,
      )
      return
    }

    await this.prisma.subscription.update({
      where: { userId },
      data: {
        plan: SubscriptionPlan.FORGE,
        status: 'ACTIVE',
        stripeSubscriptionId: null,
        billingCycle: 'MONTHLY',
        currentPrice: 0,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAt: null,
        cancelAtPeriodEnd: false,
      },
    })

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        eventType: SubscriptionEventType.SUBSCRIPTION_CANCELED,
        oldStatus: subscription.status,
        newStatus: 'ACTIVE',
        oldPlan: subscription.plan,
        newPlan: SubscriptionPlan.FORGE,
        description: 'Subscription canceled — downgraded to Forge',
      },
    })

    this.logger.log(`Subscription deleted for user ${userId} — plan reset to FORGE`)
  }

  /**
   * invoice.finalized
   * Create Invoice + initial Payment record in DB.
   * Skip $0 invoices (trial or free plan) — they have no PaymentIntent so no Payment row is needed.
   */
  private async handleInvoiceFinalized(invoice: Stripe.Invoice) {
    const stripeSubId = extractSubscriptionIdFromInvoice(invoice)
    this.logger.log(
      `[INVOICE_FINALIZED] invoiceId=${invoice.id} stripeSubId=${stripeSubId ?? 'none'} ` +
      `amountDue=${(invoice.amount_due ?? 0) / 100} status=${invoice.status}`,
    )

    if ((invoice.amount_due ?? 0) === 0) {
      this.logger.log(`[INVOICE_FINALIZED] Skipping $0 invoice ${invoice.id} (trial/free — no payment needed)`)
      return
    }

    // Resolve our internal subscription record
    let internalSub = await this.findSubscriptionForInvoice(invoice)

    if (!internalSub) {
      // Race condition: checkout.session.completed hasn't written the sub ID yet
      this.logger.warn(`[INVOICE_FINALIZED] Subscription not found for invoice ${invoice.id} — waiting 2s and retrying`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      internalSub = await this.findSubscriptionForInvoice(invoice)
    }

    if (!internalSub) {
      throw new Error(
        `Subscription not found for Stripe subscription ${stripeSubId ?? 'unknown'} — Stripe will retry`,
      )
    }

    this.logger.log(`[INVOICE_FINALIZED] Resolved internal subscriptionId=${internalSub.id}`)

    const paymentIntentId = this.extractPaymentIntentId(invoice)

    if (!paymentIntentId) {
      this.logger.warn(
        `[INVOICE_FINALIZED] No paymentIntentId on invoice ${invoice.id} ` +
        `(amountDue=${(invoice.amount_due ?? 0) / 100}) — invoice record will be created without a Payment row`,
      )
    } else {
      this.logger.log(`[INVOICE_FINALIZED] paymentIntentId=${paymentIntentId}`)
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({ where: { stripeInvoiceId: invoice.id } })

      if (existing) {
        this.logger.log(`[INVOICE_FINALIZED] Invoice ${invoice.id} already in DB (id=${existing.id}) — checking payment link`)
        // Invoice already exists — just link a payment intent that arrived out of order
        if (paymentIntentId) {
          const existingPayment = await tx.payment.findUnique({
            where: { stripePaymentIntentId: paymentIntentId },
          })
          if (existingPayment && !existingPayment.invoiceId) {
            await tx.payment.update({
              where: { stripePaymentIntentId: paymentIntentId },
              data: { invoiceId: existing.id },
            })
            this.logger.log(`[INVOICE_FINALIZED] Linked existing payment ${existingPayment.id} → invoice ${existing.id}`)
          }
        }
        return
      }

      const createdInvoice = await tx.invoice.create({
        data: {
          subscriptionId: internalSub.id,
          stripeInvoiceId: invoice.id,
          stripeHostedUrl: invoice.hosted_invoice_url,
          stripePdfUrl: invoice.invoice_pdf,
          status: invoice.status === 'paid' ? 'PAID' : invoice.status === 'void' ? 'VOID' : 'OPEN',
          amountDue: (invoice.amount_due ?? 0) / 100,
          amountPaid: (invoice.amount_paid ?? 0) / 100,
          amountRemaining: (invoice.amount_remaining ?? 0) / 100,
          currency: invoice.currency,
          invoiceDate: new Date(invoice.created * 1000),
          dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
          periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
          periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
          description: invoice.description,
          metadata: invoice.metadata as any,
          paidAt: invoice.status === 'paid' ? new Date() : null,
        },
      })

      this.logger.log(`[INVOICE_FINALIZED] Created invoice record id=${createdInvoice.id}`)

      if (paymentIntentId) {
        const existingPayment = await tx.payment.findUnique({
          where: { stripePaymentIntentId: paymentIntentId },
        })

        if (!existingPayment) {
          await tx.payment.create({
            data: {
              subscriptionId: internalSub.id,
              invoiceId: createdInvoice.id,
              stripePaymentIntentId: paymentIntentId,
              status: 'PENDING',
              amount: (invoice.amount_due ?? 0) / 100,
              currency: invoice.currency,
            },
          })
          this.logger.log(`[INVOICE_FINALIZED] Created Payment record (PENDING) for paymentIntentId=${paymentIntentId}`)
        } else {
          await tx.payment.update({
            where: { stripePaymentIntentId: paymentIntentId },
            data: { invoiceId: createdInvoice.id },
          })
          this.logger.log(`[INVOICE_FINALIZED] Linked existing Payment ${existingPayment.id} → invoice ${createdInvoice.id}`)
        }
      }
    })
  }

  /**
   * invoice.paid
   * Mark invoice and linked payment as SUCCEEDED.
   * Skip $0 invoices (trial/free) — no payment row was created for them.
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    this.logger.log(
      `[INVOICE_PAID] invoiceId=${invoice.id} amountPaid=${(invoice.amount_paid ?? 0) / 100}`,
    )

    if ((invoice.amount_paid ?? 0) === 0) {
      this.logger.log(`[INVOICE_PAID] Skipping $0 invoice ${invoice.id} (trial/free — no payment record)`)
      return
    }

    const dbInvoice = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
    })
    if (!dbInvoice) {
      this.logger.warn(`[INVOICE_PAID] No DB record for invoice ${invoice.id} — invoice.finalized may not have been processed yet, skipping`)
      return
    }

    await this.prisma.invoice.update({
      where: { stripeInvoiceId: invoice.id },
      data: {
        status: 'PAID',
        amountPaid: (invoice.amount_paid ?? 0) / 100,
        amountRemaining: 0,
        paidAt: new Date(),
      },
    })

    const paymentIntentId = this.extractPaymentIntentId(invoice)
    if (paymentIntentId) {
      const result = await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      })
      if (result.count === 0) {
        this.logger.warn(
          `[INVOICE_PAID] paymentIntentId=${paymentIntentId} — no Payment row found to update. ` +
          `invoice.finalized may have had no paymentIntentId when it ran.`,
        )
      } else {
        this.logger.log(`[INVOICE_PAID] Marked ${result.count} Payment(s) SUCCEEDED for paymentIntentId=${paymentIntentId}`)
      }
    } else {
      this.logger.warn(`[INVOICE_PAID] No paymentIntentId on invoice ${invoice.id} — no Payment row to update`)
    }

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: dbInvoice.subscriptionId,
        eventType: SubscriptionEventType.PAYMENT_SUCCEEDED,
        description: `Invoice paid: ${(invoice.amount_paid ?? 0) / 100} ${invoice.currency.toUpperCase()}`,
      },
    })
  }

  /**
   * invoice.payment_failed
   * Mark payment FAILED, set subscription to PAST_DUE.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const dbInvoice = await this.prisma.invoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
    })
    if (!dbInvoice) {
      this.logger.warn(`invoice.payment_failed: no DB record for ${invoice.id} — skipping`)
      return
    }

    const paymentIntentId = this.extractPaymentIntentId(invoice)
    if (paymentIntentId) {
      await this.prisma.payment.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: { status: 'FAILED', failedAt: new Date() },
      })
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: dbInvoice.subscriptionId },
    })

    if (subscription) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'PAST_DUE' },
      })

      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          eventType: SubscriptionEventType.PAYMENT_FAILED,
          oldStatus: subscription.status,
          newStatus: 'PAST_DUE',
          description: 'Payment failed — subscription is now past due',
        },
      })
    }
  }

  /** invoice.voided */
  private async handleInvoiceVoided(invoice: Stripe.Invoice) {
    await this.prisma.invoice.updateMany({
      where: { stripeInvoiceId: invoice.id },
      data: { status: 'VOID' },
    })
  }

  /**
   * payment_intent.succeeded
   * Scrummer-style: find or create the Payment row in a single transaction.
   * Handles race where invoice.finalized fires before Stripe attaches the PI to the invoice.
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const piAny = paymentIntent as any
    this.logger.log(`[PI_SUCCEEDED] paymentIntentId=${paymentIntent.id} amount=${paymentIntent.amount / 100} ${paymentIntent.currency}`)

    // Resolve charge and card details up front
    const chargeId =
      typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : (paymentIntent.latest_charge as Stripe.Charge | null)?.id ?? piAny.charges?.data?.[0]?.id ?? null

    let cardBrand: string | undefined
    let cardLast4: string | undefined
    let cardExpMonth: number | undefined
    let cardExpYear: number | undefined
    let paymentMethod: string | undefined

    if (chargeId) {
      try {
        const charge = await this.stripe.charges.retrieve(chargeId)
        paymentMethod = charge.payment_method_details?.type ?? undefined
        cardBrand = charge.payment_method_details?.card?.brand ?? undefined
        cardLast4 = charge.payment_method_details?.card?.last4 ?? undefined
        cardExpMonth = charge.payment_method_details?.card?.exp_month ?? undefined
        cardExpYear = charge.payment_method_details?.card?.exp_year ?? undefined
      } catch (error) {
        this.logger.warn(`Could not retrieve charge ${chargeId}: ${error.message}`)
      }
    }

    const cardData = {
      ...(chargeId && { stripeChargeId: chargeId }),
      paymentMethod: paymentMethod ?? paymentIntent.payment_method_types?.[0] ?? null,
      cardBrand: cardBrand ?? null,
      cardLast4: cardLast4 ?? null,
      cardExpMonth: cardExpMonth ?? null,
      cardExpYear: cardExpYear ?? null,
    }

    // ── Case 1: Payment row already exists (normal path — invoice.finalized ran first) ──
    const existingPayment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntent.id },
    })

    if (existingPayment) {
      await this.prisma.payment.update({
        where: { id: existingPayment.id },
        data: { status: 'SUCCEEDED', paidAt: new Date(), ...cardData },
      })
      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: existingPayment.subscriptionId,
          eventType: SubscriptionEventType.PAYMENT_SUCCEEDED,
          description: `Payment succeeded: ${existingPayment.amount} ${paymentIntent.currency.toUpperCase()}`,
        },
      })
      this.logger.log(`[PI_SUCCEEDED] Updated existing Payment to SUCCEEDED for paymentIntentId=${paymentIntent.id}`)
      return
    }

    // ── Case 2: No Payment row (invoice.finalized had no PI yet — create it now) ──
    this.logger.warn(
      `[PI_SUCCEEDED] No Payment row for paymentIntentId=${paymentIntent.id} — ` +
      `invoice.finalized fired before PI was attached. Creating now.`,
    )

    // Resolve the subscription: invoice field on PI → customer fallback
    const stripeInvoiceId = typeof piAny.invoice === 'string' ? piAny.invoice : piAny.invoice?.id ?? null
    const customerId =
      typeof paymentIntent.customer === 'string'
        ? paymentIntent.customer
        : (paymentIntent.customer as Stripe.Customer | null)?.id ?? null

    let subscription: { id: string; status: string } | null = null

    if (stripeInvoiceId) {
      try {
        const stripeInvoice = await this.stripe.invoices.retrieve(stripeInvoiceId)
        const subId = extractSubscriptionIdFromInvoice(stripeInvoice)
        if (subId) {
          subscription = await this.prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subId },
            select: { id: true, status: true },
          })
        }
      } catch (err) {
        this.logger.warn(`Could not retrieve invoice ${stripeInvoiceId}: ${err.message}`)
      }
    }

    if (!subscription && customerId) {
      subscription = await this.prisma.subscription.findUnique({
        where: { stripeCustomerId: customerId },
        select: { id: true, status: true },
      })
    }

    if (!subscription) {
      this.logger.error(
        `[PI_SUCCEEDED] Cannot create Payment — no subscription found for paymentIntentId=${paymentIntent.id}`,
      )
      return
    }

    // Create (or update) the Payment in a transaction, linking to invoice if available
    const createdPayment = await this.prisma.$transaction(async (tx) => {
      // Guard against duplicate (another webhook delivery may have raced us)
      const duplicate = await tx.payment.findUnique({ where: { stripePaymentIntentId: paymentIntent.id } })

      // Try to find matching invoice by stripeInvoiceId first, then recent orphan
      let invoiceDbId: string | undefined
      if (stripeInvoiceId) {
        const inv = await tx.invoice.findUnique({ where: { stripeInvoiceId }, select: { id: true } })
        if (inv) invoiceDbId = inv.id
      }
      if (!invoiceDbId) {
        const orphan = await tx.invoice.findFirst({
          where: { subscriptionId: subscription.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        if (orphan) invoiceDbId = orphan.id
      }

      if (duplicate) {
        return tx.payment.update({
          where: { stripePaymentIntentId: paymentIntent.id },
          data: { status: 'SUCCEEDED', paidAt: new Date(), invoiceId: invoiceDbId, ...cardData },
        })
      }

      return tx.payment.create({
        data: {
          subscriptionId: subscription.id,
          invoiceId: invoiceDbId,
          stripePaymentIntentId: paymentIntent.id,
          status: 'SUCCEEDED',
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
          paidAt: new Date(),
          ...cardData,
        },
      })
    })

    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        eventType: SubscriptionEventType.PAYMENT_SUCCEEDED,
        description: `Payment succeeded: ${createdPayment.amount} ${paymentIntent.currency.toUpperCase()}`,
      },
    })

    this.logger.log(`[PI_SUCCEEDED] Created Payment record for paymentIntentId=${paymentIntent.id}`)
  }

  /** payment_intent.payment_failed */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    const lastError = paymentIntent.last_payment_error
    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: lastError?.message ?? null,
        failureCode: lastError?.code ?? null,
        retriedCount: { increment: 1 },
      },
    })
  }

  /** payment_intent.canceled */
  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent) {
    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: { status: 'CANCELED' },
    })
  }

  /**
   * charge.refunded
   * Update payment status to REFUNDED or PARTIALLY_REFUNDED.
   */
  private async handleChargeRefunded(charge: Stripe.Charge) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : (charge.payment_intent as Stripe.PaymentIntent | null)?.id ?? null

    if (!paymentIntentId) return

    const isFullRefund = charge.amount_refunded >= charge.amount
    const status = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED'

    await this.prisma.payment.updateMany({
      where: { stripePaymentIntentId: paymentIntentId },
      data: { status },
    })

    const payment = await this.prisma.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    })

    if (payment) {
      await this.prisma.subscriptionHistory.create({
        data: {
          subscriptionId: payment.subscriptionId,
          eventType: SubscriptionEventType.PAYMENT_REFUNDED,
          description: `${isFullRefund ? 'Full' : 'Partial'} refund: ${charge.amount_refunded / 100} ${charge.currency.toUpperCase()}`,
        },
      })
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Look up our Subscription record for a given Stripe invoice.
   * Tries by Stripe subscription ID first, falls back to customer ID.
   */
  private async findSubscriptionForInvoice(invoice: Stripe.Invoice) {
    const stripeSubId = extractSubscriptionIdFromInvoice(invoice)

    if (stripeSubId) {
      const sub = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: stripeSubId },
      })
      if (sub) return sub
    }

    // Fallback: find by customer ID
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
    if (customerId) {
      return this.prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } })
    }

    return null
  }

  /** Extract payment_intent ID from an invoice regardless of expansion state. */
  private extractPaymentIntentId(invoice: Stripe.Invoice): string | null {
    const pi = (invoice as any).payment_intent
    if (!pi) return null
    if (typeof pi === 'string') return pi
    if (typeof pi === 'object' && pi.id) return pi.id
    return null
  }

  /** Derive the correct SubscriptionEventType from old/new plan and status. */
  private resolveSubscriptionEventType(
    oldPlan: SubscriptionPlan,
    newPlan: SubscriptionPlan,
    oldStatus: string,
    newStatus: string,
  ): SubscriptionEventType {
    if (newStatus === 'CANCELED') return SubscriptionEventType.SUBSCRIPTION_CANCELED
    if (newStatus === 'PAUSED') return SubscriptionEventType.SUBSCRIPTION_PAUSED
    if (oldStatus === 'PAUSED' && newStatus === 'ACTIVE') return SubscriptionEventType.SUBSCRIPTION_RESUMED
    if (oldStatus === 'CANCELED' && newStatus === 'ACTIVE') return SubscriptionEventType.SUBSCRIPTION_REACTIVATED

    if (oldPlan !== newPlan) {
      const oldOrder = PLAN_ORDER[oldPlan] ?? 0
      const newOrder = PLAN_ORDER[newPlan] ?? 0
      if (newOrder > oldOrder) return SubscriptionEventType.PLAN_UPGRADED
      if (newOrder < oldOrder) return SubscriptionEventType.PLAN_DOWNGRADED
    }

    return SubscriptionEventType.SUBSCRIBED
  }

  private buildChangeDescription(
    oldPlan: SubscriptionPlan,
    newPlan: SubscriptionPlan,
    oldStatus: string,
    newStatus: string,
    newBilling: string,
    oldBilling: string,
  ): string {
    const changes: string[] = []
    if (oldPlan !== newPlan) changes.push(`plan: ${oldPlan} → ${newPlan}`)
    if (oldStatus !== newStatus) changes.push(`status: ${oldStatus} → ${newStatus}`)
    if (oldBilling !== newBilling) changes.push(`billing: ${oldBilling} → ${newBilling}`)
    return changes.length > 0 ? changes.join(', ') : 'subscription synced'
  }
}
