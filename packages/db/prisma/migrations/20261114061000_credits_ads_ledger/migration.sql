-- CreateEnum
CREATE TYPE "CreditEntryType" AS ENUM ('AD_REWARD', 'TOPUP', 'GRANT', 'ADJUSTMENT', 'CONVERT', 'REFUND');

-- CreateEnum
CREATE TYPE "CreditSource" AS ENUM ('HOUSE', 'SPONSOR', 'OPERATOR', 'PAYMENT');

-- CreateEnum
CREATE TYPE "AdSessionStatus" AS ENUM ('ISSUED', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CreditEntryType" NOT NULL,
    "source" "CreditSource" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "tokensGranted" BIGINT,
    "adSessionId" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "tagline" TEXT,
    "videoUrl" TEXT NOT NULL,
    "posterUrl" TEXT,
    "accent" TEXT NOT NULL DEFAULT '#67dcf2',
    "durationMs" INTEGER NOT NULL DEFAULT 7000,
    "source" "CreditSource" NOT NULL DEFAULT 'HOUSE',
    "sourceUrl" TEXT,
    "license" TEXT,
    "rewardMin" INTEGER NOT NULL DEFAULT 700,
    "rewardMax" INTEGER NOT NULL DEFAULT 5000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "status" "AdSessionStatus" NOT NULL DEFAULT 'ISSUED',
    "reward" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "interruptions" INTEGER NOT NULL DEFAULT 0,
    "watchedMs" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "userAgent" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "rupiahPer1MTokens" INTEGER NOT NULL DEFAULT 1000,
    "minConvertMinor" INTEGER NOT NULL DEFAULT 10000,
    "dailyAdsPerUser" INTEGER NOT NULL DEFAULT 12,
    "dailyRewardCapMinor" BIGINT NOT NULL DEFAULT 60000,
    "weeklyTokenCap" BIGINT NOT NULL DEFAULT 5000000,
    "minWatchRatio" INTEGER NOT NULL DEFAULT 85,
    "sessionTtlSeconds" INTEGER NOT NULL DEFAULT 300,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_adSessionId_key" ON "CreditLedgerEntry"("adSessionId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_createdAt_idx" ON "CreditLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_createdAt_idx" ON "CreditLedgerEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdCreative_slug_key" ON "AdCreative"("slug");

-- CreateIndex
CREATE INDEX "AdCreative_active_idx" ON "AdCreative"("active");

-- CreateIndex
CREATE UNIQUE INDEX "AdSession_nonce_key" ON "AdSession"("nonce");

-- CreateIndex
CREATE INDEX "AdSession_userId_issuedAt_idx" ON "AdSession"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "AdSession_status_idx" ON "AdSession"("status");

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_adSessionId_fkey" FOREIGN KEY ("adSessionId") REFERENCES "AdSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSession" ADD CONSTRAINT "AdSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSession" ADD CONSTRAINT "AdSession_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "AdCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

