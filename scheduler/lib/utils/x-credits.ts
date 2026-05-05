import { prisma } from "@/lib/prisma";
import { BadRequestError } from "@/lib/utils/errors";

export async function getXCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { xPostingCredits: true },
  });
  return user.xPostingCredits;
}

export async function checkAndDeductXCredits(userId: string, accountIds: string[]): Promise<void> {
  const xAccountCount = await prisma.connectedAccount.count({
    where: { id: { in: accountIds }, userId, platform: "x" },
  });

  if (xAccountCount === 0) return;

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { xPostingCredits: true },
    });

    if (user.xPostingCredits < xAccountCount) {
      throw new BadRequestError(
        user.xPostingCredits === 0
          ? "You have no X posting credits remaining."
          : `You need ${xAccountCount} X posting credit${xAccountCount > 1 ? "s" : ""} but only have ${user.xPostingCredits} remaining.`,
      );
    }

    await tx.user.update({
      where: { id: userId },
      data: { xPostingCredits: { decrement: xAccountCount } },
    });
  });
}
