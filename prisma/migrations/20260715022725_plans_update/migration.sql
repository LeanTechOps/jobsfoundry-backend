/*
  Warnings:

  - The values [FREE,PRO,BUSINESS,PRO_FREE] on the enum `SubscriptionPlan` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionPlan_new" AS ENUM ('FORGE', 'FORGE_FREE', 'CRAFT', 'LAUNCH', 'MOMENTUM');
ALTER TABLE "public"."Subscription" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE "SubscriptionPlan_new" USING ("plan"::text::"SubscriptionPlan_new");
ALTER TABLE "SubscriptionHistory" ALTER COLUMN "oldPlan" TYPE "SubscriptionPlan_new" USING ("oldPlan"::text::"SubscriptionPlan_new");
ALTER TABLE "SubscriptionHistory" ALTER COLUMN "newPlan" TYPE "SubscriptionPlan_new" USING ("newPlan"::text::"SubscriptionPlan_new");
ALTER TYPE "SubscriptionPlan" RENAME TO "SubscriptionPlan_old";
ALTER TYPE "SubscriptionPlan_new" RENAME TO "SubscriptionPlan";
DROP TYPE "public"."SubscriptionPlan_old";
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DEFAULT 'FORGE';
COMMIT;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DEFAULT 'FORGE';
