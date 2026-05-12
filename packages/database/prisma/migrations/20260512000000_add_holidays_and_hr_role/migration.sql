-- Run: pnpm db:migrate or prisma migrate dev

-- AlterEnum: add HR between MANAGER and STAFF
ALTER TYPE "EmployeeRole" ADD VALUE IF NOT EXISTS 'HR';

-- CreateTable: Holiday — company calendar of non-working days
CREATE TABLE "Holiday" (
    "id"        TEXT         NOT NULL,
    "companyId" TEXT         NOT NULL,
    "date"      DATE         NOT NULL,
    "name"      TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Holiday_companyId_idx" ON "Holiday"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");

-- AddForeignKey
ALTER TABLE "Holiday"
    ADD CONSTRAINT "Holiday_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
