import { RichText, AppBskyRichtextFacet } from "@atproto/api";
import axios from "axios";

const handles = new Map<string, { expires: number; promise: Promise<string | undefined> }>();

async function resolveHandle(handle: string): Promise<string | undefined> {
  const cached = handles.get(handle);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = axios
    .get<{ did: string }>("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle", {
      params: { handle },
      timeout: 3000,
      maxRedirects: 0,
      maxContentLength: 4096,
    })
    .then(({ data }) => (/^did:(plc:[a-z2-7]{24}|web:[^\s]+)$/.test(data.did) ? data.did : undefined))
    .catch((): undefined => {
      /* An unavailable handle remains plain text. */
    });
  if (handles.size >= 128) handles.delete(handles.keys().next().value!);
  handles.set(handle, { expires: Date.now() + 5 * 60_000, promise });
  return promise;
}

/** The official parser preserves text and calculates UTF-8 byte ranges. */
export async function blueskyFacets(text: string) {
  const richText = new RichText({ text });
  richText.detectFacetsWithoutResolution();
  const facets = richText.facets ?? [];
  // Resolve at most ten distinct handles, concurrently. Failed or excess
  // mentions stay plain text, rather than invalidating the published record.
  const mentions = [
    ...new Set(
      facets.flatMap((facet) =>
        facet.features.filter((feature) => AppBskyRichtextFacet.isMention(feature)).map((feature) => feature.did),
      ),
    ),
  ].slice(0, 10);
  const resolved = new Map(
    await Promise.all(mentions.map(async (handle) => [handle, await resolveHandle(handle)] as const)),
  );
  for (const facet of facets) {
    facet.features = facet.features.flatMap((feature) => {
      if (!AppBskyRichtextFacet.isMention(feature)) return [feature];
      const did = resolved.get(feature.did);
      return did ? [{ ...feature, did }] : [];
    });
  }
  return facets.filter((facet) => facet.features.length > 0);
}

export function firstBlueskyLink(facets: AppBskyRichtextFacet.Main[]): string | undefined {
  for (const facet of facets) {
    for (const feature of facet.features) {
      if (AppBskyRichtextFacet.isLink(feature) && /^https?:\/\//i.test(feature.uri)) return feature.uri;
    }
  }
  return undefined;
}
