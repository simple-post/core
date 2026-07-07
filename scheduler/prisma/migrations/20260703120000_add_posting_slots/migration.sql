-- CreateTable
CREATE TABLE "posting_slot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "posting_slot_userId_idx" ON "posting_slot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "posting_slot_userId_time_key" ON "posting_slot"("userId", "time");

-- AddForeignKey
ALTER TABLE "posting_slot" ADD CONSTRAINT "posting_slot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
