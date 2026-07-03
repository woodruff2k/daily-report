-- CreateEnum
CREATE TYPE "RepStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('VISIT', 'CALL', 'ONLINE');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "sales_rep" (
    "rep_id" BIGSERIAL NOT NULL,
    "emp_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "manager_id" BIGINT,
    "status" "RepStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_rep_pkey" PRIMARY KEY ("rep_id")
);

-- CreateTable
CREATE TABLE "customer" (
    "customer_id" BIGSERIAL NOT NULL,
    "customer_name" TEXT NOT NULL,
    "company_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "grade" TEXT,
    "assigned_rep_id" BIGINT,
    "status" "RepStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "daily_report" (
    "report_id" BIGSERIAL NOT NULL,
    "rep_id" BIGINT NOT NULL,
    "report_date" DATE NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_report_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "visit_record" (
    "visit_id" BIGSERIAL NOT NULL,
    "report_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "visit_time" TEXT,
    "visit_type" "VisitType" NOT NULL,
    "content" TEXT NOT NULL,
    "result" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_record_pkey" PRIMARY KEY ("visit_id")
);

-- CreateTable
CREATE TABLE "report_problem" (
    "problem_id" BIGSERIAL NOT NULL,
    "report_id" BIGINT NOT NULL,
    "customer_id" BIGINT,
    "content" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_problem_pkey" PRIMARY KEY ("problem_id")
);

-- CreateTable
CREATE TABLE "report_plan" (
    "plan_id" BIGSERIAL NOT NULL,
    "report_id" BIGINT NOT NULL,
    "customer_id" BIGINT,
    "planned_date" DATE,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_plan_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "report_comment" (
    "comment_id" BIGSERIAL NOT NULL,
    "report_id" BIGINT NOT NULL,
    "commenter_id" BIGINT NOT NULL,
    "parent_comment_id" BIGINT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_comment_pkey" PRIMARY KEY ("comment_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_emp_no_key" ON "sales_rep"("emp_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_email_key" ON "sales_rep"("email");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_rep_id_report_date_key" ON "daily_report"("rep_id", "report_date");

-- AddForeignKey
ALTER TABLE "sales_rep" ADD CONSTRAINT "sales_rep_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "sales_rep"("rep_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_assigned_rep_id_fkey" FOREIGN KEY ("assigned_rep_id") REFERENCES "sales_rep"("rep_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_rep_id_fkey" FOREIGN KEY ("rep_id") REFERENCES "sales_rep"("rep_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_record" ADD CONSTRAINT "visit_record_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_report"("report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_record" ADD CONSTRAINT "visit_record_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_problem" ADD CONSTRAINT "report_problem_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_report"("report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_problem" ADD CONSTRAINT "report_problem_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_plan" ADD CONSTRAINT "report_plan_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_report"("report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_plan" ADD CONSTRAINT "report_plan_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comment" ADD CONSTRAINT "report_comment_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_report"("report_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comment" ADD CONSTRAINT "report_comment_commenter_id_fkey" FOREIGN KEY ("commenter_id") REFERENCES "sales_rep"("rep_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_comment" ADD CONSTRAINT "report_comment_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "report_comment"("comment_id") ON DELETE SET NULL ON UPDATE CASCADE;
