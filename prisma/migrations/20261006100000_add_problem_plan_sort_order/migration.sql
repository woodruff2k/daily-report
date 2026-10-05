-- AlterTable
ALTER TABLE "report_problem" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "report_plan" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;
