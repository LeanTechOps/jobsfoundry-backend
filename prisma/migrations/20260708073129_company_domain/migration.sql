/*
  Warnings:

  - You are about to drop the column `companyLogoUrl` on the `Job` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Job" DROP COLUMN "companyLogoUrl",
ADD COLUMN     "companyDomain" VARCHAR(255);
