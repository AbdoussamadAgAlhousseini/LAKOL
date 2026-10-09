-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('OPEN', 'BOOKED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "recipientCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenById" TEXT,
ADD COLUMN     "reportReason" TEXT,
ADD COLUMN     "reportedAt" TIMESTAMP(3),
ADD COLUMN     "reportedById" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "refId" TEXT,
ADD COLUMN     "refType" TEXT;

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MeetingSlot" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'OPEN',
    "guardianId" TEXT,
    "studentId" TEXT,
    "note" TEXT,
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingSlot_schoolId_staffId_startsAt_idx" ON "MeetingSlot"("schoolId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "MeetingSlot_schoolId_guardianId_idx" ON "MeetingSlot"("schoolId", "guardianId");

-- CreateIndex
CREATE INDEX "Message_schoolId_reportedAt_idx" ON "Message"("schoolId", "reportedAt");

-- CreateIndex
CREATE INDEX "Notification_refType_refId_idx" ON "Notification"("refType", "refId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_scheduledFor_idx" ON "NotificationDelivery"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "MeetingSlot" ADD CONSTRAINT "MeetingSlot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

