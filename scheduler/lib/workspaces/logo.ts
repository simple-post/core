import sharp from "sharp";

import { BadRequestError } from "@/lib/utils/errors";

export async function normalizeWorkspaceLogo(logo: string | null | undefined) {
  if (logo == null) return logo;
  try {
    const [, input] = logo.split(",");
    const image = sharp(Buffer.from(input, "base64"), { limitInputPixels: 16_000_000 });
    const { format } = await image.metadata();
    if (!format || !["jpeg", "png", "webp"].includes(format)) throw new Error("Unsupported image format");
    const bytes = await image.rotate().resize(160, 160, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    return `data:image/webp;base64,${bytes.toString("base64")}`;
  } catch {
    throw new BadRequestError("Choose a valid PNG, JPEG, or WebP image for the workspace logo.");
  }
}
