import { Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ProviderEnum, SubscriptionPlan, SubscriptionStatus } from '@prisma/client'
import { PrismaService } from 'src/prisma/prisma.service'
import { StripeService } from 'src/stripe/stripe.service'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly stripeService: StripeService,
  ) {}

  async googleLogin(googleUser: {
    googleId: string
    email: string
    firstName: string
    lastName: string
    avatar: string
    accessToken: string
    refreshToken: string
  }): Promise<string> {
    let user = await this.prisma.user.findUnique({
      where: { email: googleUser.email },
      select: { id: true, authProviders: { select: { id: true, providerId: true } } },
    })

    if (!user) {
      user = await this.prisma.$transaction(async (tx) => {
        return tx.user.create({
          data: {
            email: googleUser.email,
            firstName: googleUser.firstName,
            lastName: googleUser.lastName,
            avatar: googleUser.avatar,
            authProviders: {
              create: {
                provider: ProviderEnum.GOOGLE,
                providerId: googleUser.googleId,
                accessToken: googleUser.accessToken,
                refreshToken: googleUser.refreshToken,
              },
            },
            subscription: {
              create: {
                plan: SubscriptionPlan.FREE,
                status: SubscriptionStatus.ACTIVE,
              },
            },
          },
          select: { id: true, authProviders: { select: { id: true, providerId: true } } },
        })
      })

      this.logger.log(`New user created: ${googleUser.email}`)

      // Await Stripe setup so the subscription plan in DB is correct before the JWT is issued.
      // This prevents the dashboard from flashing FREE on first load for returning Stripe customers.
      const name = [googleUser.firstName, googleUser.lastName].filter(Boolean).join(' ') || undefined
      const createdUserId = user.id
      try {
        await this.stripeService.createTrialSubscription(createdUserId, googleUser.email, name)
      } catch (err) {
        // Non-fatal: subscription stays FREE in DB. Webhook will correct it later.
        this.logger.error(`Stripe trial setup failed for ${createdUserId}: ${err.message}`)
      }
    } else {
      await this.prisma.authProvider.upsert({
        where: {
          provider_providerId: {
            provider: ProviderEnum.GOOGLE,
            providerId: googleUser.googleId,
          },
        },
        create: {
          userId: user.id,
          provider: ProviderEnum.GOOGLE,
          providerId: googleUser.googleId,
          accessToken: googleUser.accessToken,
          refreshToken: googleUser.refreshToken,
        },
        update: {
          accessToken: googleUser.accessToken,
          refreshToken: googleUser.refreshToken,
        },
      })

      // Re-sync subscription with Stripe on every login for existing users.
      // This ensures plan/status in DB is up to date before the JWT is issued,
      // preventing the dashboard from flashing the wrong plan on first load.
      const name = [googleUser.firstName, googleUser.lastName].filter(Boolean).join(' ') || undefined
      try {
        await this.stripeService.createTrialSubscription(user.id, googleUser.email, name)
      } catch (err) {
        this.logger.error(`Stripe re-sync failed for ${user.id}: ${err.message}`)
      }
    }

    const payload = { sub: user.id, email: googleUser.email }
    return this.jwtService.sign(payload)
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            billingCycle: true,
            cancelAtPeriodEnd: true,
          },
        },
      },
    })

    const now = new Date()
    const isInTrial =
      user.subscription?.plan === SubscriptionPlan.FREE &&
      user.subscription?.currentPeriodEnd != null &&
      user.subscription.currentPeriodEnd > now

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
      subscription: user.subscription
        ? {
            plan: user.subscription.plan,
            status: user.subscription.status,
            currentPeriodStart: user.subscription.currentPeriodStart,
            currentPeriodEnd: user.subscription.currentPeriodEnd,
            billingCycle: user.subscription.billingCycle,
            cancelAtPeriodEnd: user.subscription.cancelAtPeriodEnd,
            isInTrial,
            trialDaysRemaining: isInTrial
              ? Math.max(
                  0,
                  Math.ceil(
                    (user.subscription.currentPeriodEnd!.getTime() - now.getTime()) /
                      (1000 * 60 * 60 * 24),
                  ),
                )
              : 0,
          }
        : null,
    }
  }
}
