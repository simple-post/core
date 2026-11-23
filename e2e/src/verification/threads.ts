import type { Locator, Page } from "@playwright/test";
import { VerificationSetupError } from "./retry.js";

export const formerThreadsReplySelector =
  '[data-pagelet="threads_post_page_0"] > div:nth-last-child(2) a[href*="/post/"]:has(time)';

export function threadsPostPath(value: string, base = "https://www.threads.com"): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || !/^(?:www\.)?threads\.(?:com|net)$/.test(url.hostname)) return;
    if (url.username || url.password || !/^\/@[^/]+\/post\/[^/]+\/?$/.test(url.pathname)) return;
    return url.pathname.replace(/\/$/, "");
  } catch {
    return;
  }
}

// Timestamp links identify actual posts; header and media links cannot select a card.
export function threadsPostRoot(page: Page, roots: Locator): Locator {
  const path = threadsPostPath(page.url());
  if (!path) throw new VerificationSetupError("Threads verification requires the exact post permalink.");
  const urls = [
    path,
    ...["threads.com", "www.threads.com", "threads.net", "www.threads.net"].map((host) => `https://${host}${path}`),
  ];
  const selectors = urls.flatMap((url) => [
    `a[href=${JSON.stringify(url)}]:has(time)`,
    `a[href=${JSON.stringify(url + "/")}]:has(time)`,
    `a[href^=${JSON.stringify(url + "?")}]:has(time)`,
    `a[href^=${JSON.stringify(url + "/?")}]:has(time)`,
  ]);
  return roots.filter({ has: page.locator(selectors.join(", ")) });
}

export async function threadsDirectParentPaths(page: Page, root: Locator): Promise<string[]> {
  // Conversation pagelets have ordered indices. Require the immediately preceding
  // sibling pagelet; recommendations or a more distant ancestor cannot prove a reply.
  const current = root.locator('xpath=ancestor::*[starts-with(@data-pagelet,"threads_post_page_")][1]');
  const id = await current.getAttribute("data-pagelet");
  const index = id?.match(/^threads_post_page_(\d+)$/)?.[1];
  if (!index || Number(index) < 1) return [];
  const parent = current.locator(
    `xpath=preceding-sibling::*[1][@data-pagelet="threads_post_page_${Number(index) - 1}"]`,
  );
  const hrefs = await parent
    .locator('a[href*="/post/"]:has(time)')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLAnchorElement).href));
  return [...new Set(hrefs.flatMap((href) => threadsPostPath(href, page.url()) ?? []))];
}
