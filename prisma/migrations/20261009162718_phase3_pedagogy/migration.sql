-- CreateEnum
CREATE TYPE "TimetableExceptionKind" AS ENUM ('CANCELLED', 'REPLACED');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "justificationSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "justifiedById" TEXT,
ADD COLUMN     "parentNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TimetableException" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "TimetableExceptionKind" NOT NULL,
    "replacementStaffId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableException_schoolId_date_idx" ON "TimetableException"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableException_slotId_date_key" ON "TimetableException"("slotId", "date");

-- AddForeignKey
ALTER TABLE "TimetableException" ADD CONSTRAINT "TimetableException_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableException" ADD CONSTRAINT "TimetableException_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "TimetableSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

