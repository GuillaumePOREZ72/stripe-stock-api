/*
  Warnings:

  - You are about to drop the column `amount` on the `prices` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `prices` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `stripeProductId` on the `products` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `products_stripeProductId_key` ON `products`;

-- AlterTable
ALTER TABLE `prices` DROP COLUMN `amount`,
    DROP COLUMN `currency`;

-- AlterTable
ALTER TABLE `products` DROP COLUMN `description`,
    DROP COLUMN `stripeProductId`;
