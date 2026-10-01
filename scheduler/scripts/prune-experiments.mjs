/** Run daily on the scheduler host: node scripts/prune-experiments.mjs --apply */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  if (!process.argv.includes("--apply"))
    throw new Error("Pass --apply to prune experiment evidence older than 180 days");
  const cutoff = new Date(Date.now() - 180 * 86_400_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { createdAt: { lt: cutoff }, experimentAttribution: { not: null } },
      data: { experimentAttribution: null },
    });
    await tx.experimentExposure.deleteMany({ where: { exposedAt: { lt: cutoff } } });
  });
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
