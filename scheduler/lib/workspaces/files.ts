import { prisma } from "@/lib/prisma";
import { BadRequestError, NotFoundError } from "@/lib/utils/errors";

import { authorize, lockWorkspace, membership } from "./access";
import { maxFileSize, type Actor } from "./contracts";

// Serve only known passive media inline. A claimed browser MIME alone is insufficient.
export function mediaType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (
    bytes.length >= 16 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"].includes(
      bytes.toString("ascii", 8, 12),
    )
  )
    return "video/mp4";
  throw new BadRequestError("Choose a JPEG, PNG, WebP or MP4 file");
}
export async function saveFile(actor: Actor, workspaceId: string, filename: string, bytes: Buffer) {
  if (bytes.length === 0 || bytes.length > maxFileSize) throw new BadRequestError("Files must be 8 MiB or smaller");
  const mime = mediaType(bytes);
  return prisma.$transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    authorize(await membership(tx, workspaceId, actor.id), "edit");
    const [usage] = await tx.$queryRaw<
      { size: bigint }[]
    >`SELECT COALESCE(SUM(octet_length(bytes)),0) AS size FROM "TeamFile" WHERE "workspaceId"=${workspaceId}`;
    if (Number(usage.size) + bytes.length > 512 * 1024 * 1024)
      throw new BadRequestError("Workspace media storage is full");
    return tx.teamFile.create({
      data: { workspaceId, filename: filename.slice(0, 180), mime, bytes: Uint8Array.from(bytes) },
      select: { id: true, filename: true, mime: true },
    });
  });
}
export async function readFile(actor: Actor, workspaceId: string, id: string) {
  const file = await prisma.teamFile.findFirst({
    where: { id, workspaceId, workspace: { members: { some: { userId: actor.id } } } },
  });
  if (!file) throw new NotFoundError("File not found");
  return file;
}
