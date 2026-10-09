-- CreateTable
CREATE TABLE "Appraisal" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appraisal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appraisal_schoolId_termId_idx" ON "Appraisal"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "Appraisal_termId_studentId_subjectId_key" ON "Appraisal"("termId", "studentId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassCouncilDecision_studentId_termId_key" ON "ClassCouncilDecision"("studentId", "termId");

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

