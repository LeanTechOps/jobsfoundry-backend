import Stripe from 'stripe'
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { Logger } from '@nestjs/common'

export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
    active: SubscriptionStatus.ACTIVE,
    past_due: SubscriptionStatus.PAST_DUE,
    canceled: SubscriptionStatus.CANCELED,
    incomplete: SubscriptionStatus.INCOMPLETE,
    incomplete_expired: SubscriptionStatus.CANCELED,
    unpaid: SubscriptionStatus.UNPAID,
    trialing: SubscriptionStatus.ACTIVE,
    paused: SubscriptionStatus.PAUSED,
  }

  return statusMap[stripeStatus] ?? SubscriptionStatus.INCOMPLETE
}

export function mapStripePlanToPrisma(
  planKey: string | undefined,
  fallbackPlan?: SubscriptionPlan | null,
): SubscriptionPlan | null {
  if (!planKey) return fallbackPlan ?? null

  const planMap: Record<string, SubscriptionPlan> = {
    FORGE: SubscriptionPlan.FORGE,
    LAUNCH: SubscriptionPlan.LAUNCH,
    MOMENTUM: SubscriptionPlan.MOMENTUM,
  }

  return planMap[planKey] ?? fallbackPlan ?? null
}

export function extractSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as any).subscription
  if (!sub) return null
  if (typeof sub === 'string') return sub
  if (typeof sub === 'object' && sub.id) return sub.id
  return null
}

export function extractSubscriptionIdFromSession(session: Stripe.Checkout.Session): string | null {
  if (!session.subscription) return null
  if (typeof session.subscription === 'string') return session.subscription
  if (typeof session.subscription === 'object' && session.subscription.id) return session.subscription.id
  return null
}

/**
 * Resolves (find-or-create) a Stripe customer for a user.
 * Matches by email first; creates if not found.
 * Persists result to DB subscription record.
 */
export async function resolveStripeCustomer(
  stripe: Stripe,
  prisma: PrismaService,
  params: {
    userId: string
    email?: string | null
    name?: string | null
    logPrefix?: string
    logger?: Logger
  },
): Promise<string> {
  const { userId, email, name, logPrefix = '', logger } = params

  if (!email) {
    logger?.warn(`${logPrefix}No email provided for userId=${userId} — skipping email lookup, creating new customer`)
  } else {
    logger?.log(`${logPrefix}Looking up Stripe customer by email=${email} for userId=${userId}`)
    const existing = await stripe.customers.list({ email, limit: 1 })
    const match = existing.data[0]
    if (match) {
      logger?.log(`${logPrefix}Found existing Stripe customer ${match.id} for email=${email} — reusing`)
      await prisma.subscription.update({
        where: { userId },
        data: { stripeCustomerId: match.id },
      })
      return match.id
    }
    logger?.log(`${logPrefix}No Stripe customer found for email=${email} — will create a new one`)
  }

  const customer = await stripe.customers.create({
    ...(name && { name }),
    ...(email && { email }),
    metadata: { userId },
  })

  logger?.log(`${logPrefix}Created new Stripe customer ${customer.id} for userId=${userId} (email=${email ?? 'none'})`)

  await prisma.subscription.update({
    where: { userId },
    data: { stripeCustomerId: customer.id },
  })

  return customer.id
}
