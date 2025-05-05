/*
  Warnings:

  - You are about to drop the column `unitPrice` on the `order_items` table. All the data in the column will be lost.
  - Added the required column `amount` to the `order_items` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `order_items` DROP COLUMN `unitPrice`,
    ADD COLUMN `amount` DOUBLE NOT NULL;
