ALTER TABLE "openai_ads_measurement"
  ADD COLUMN "clickReference" TEXT,
  ADD COLUMN "clickCapturedAt" TIMESTAMPTZ(3);
