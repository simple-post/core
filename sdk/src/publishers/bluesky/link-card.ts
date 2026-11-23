import { load } from "cheerio";
import sharp from "sharp";

import { fetchCardResource, validateCardUrl } from "./card-fetch";

const MAX_BYTES = 1_000_000;

export function parseCardMetadata(html: string, url: URL) {
  const $ = load(html);
  const meta = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content")?.trim();
  const title = (meta("og:title") || $("title").first().text().trim()).slice(0, 300);
  const description = (meta("og:description") || meta("description") || "").slice(0, 1000);
  let image: string | undefined;
  try {
    if (meta("og:image")) image = validateCardUrl(new URL(meta("og:image")!, url).href).href;
  } catch {
    /* Text-only card. */
  }
  return { title, description, image };
}

export async function prepareBlueskyCard(uri: string) {
  // Includes redirects, metadata and thumbnail. DNS that outlives this deadline
  // cannot open a connection once it resolves.
  const signal = AbortSignal.timeout(5000);
  try {
    const response = await fetchCardResource(uri, signal);
    if (!/^text\/html\b/i.test(response.contentType)) return;
    const { title, description, image } = parseCardMetadata(response.body.toString("utf8"), response.url);
    if (!title) return;
    let thumbnail: Buffer | undefined;
    if (image) {
      try {
        const bytes = await fetchCardResource(image, signal);
        const processor = sharp(bytes.body, { limitInputPixels: 16_000_000 });
        const metadata = await processor.metadata();
        if (["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
          const resized = await processor
            .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          if (resized.length <= MAX_BYTES) thumbnail = resized;
        }
      } catch {
        /* Thumbnail failure still permits a text-only card. */
      }
    }
    return { uri, title, description, thumbnail };
  } catch {
    return; /* A metadata failure must never block publishing. */
  }
}
