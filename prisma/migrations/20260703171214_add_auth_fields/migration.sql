/*
  Warnings:

  - Added the required column `password_hash` to the `sales_rep` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALES_REP', 'MANAGER', 'ADMIN');

-- AlterTable
ALTER TABLE "sales_rep" ADD COLUMN     "password_hash" TEXT NOT NULL,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'SALES_REP';
