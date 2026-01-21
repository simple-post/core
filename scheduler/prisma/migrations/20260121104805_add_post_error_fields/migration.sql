-- AlterTable
ALTER TABLE "post" ADD COLUMN     "errorDetails" JSONB,
ADD COLUMN     "errorMessage" TEXT;
