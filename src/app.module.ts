import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { StripeModule } from './stripe/stripe.module'
import { ProfileModule } from './profile/profile.module'
import { JobsModule } from './jobs/jobs.module'
import { AdminModule } from './admin/admin.module'
import { ApplicationsModule } from './applications/applications.module'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import appConfig from './config/config'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: true,
            ignore: 'pid,hostname,req,res,responseTime',
            singleLine: true,
          },
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[Redacted]',
        },
        autoLogging: true,
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    StripeModule,
    ProfileModule,
    JobsModule,
    AdminModule,
    ApplicationsModule,
  ],
  providers: [
    // Apply JwtAuthGuard globally; use @Public() decorator to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
