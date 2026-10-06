import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

const MAX_BYTES = 1_000_000;

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  return parsed.range() === "unicast";
}

export function validateCardUrl(value: string): URL {
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.toLowerCase() === "localhost"
  ) {
    throw new Error("Link preview requires a public HTTP(S) URL on a standard port.");
  }
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error("Private link preview address.");
  return url;
}

/** Validate every redirect and pin the connection to a vetted DNS answer. */
export async function fetchCardResource(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ body: Buffer; url: URL; contentType: string }> {
  const url = validateCardUrl(value);
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
        const aborted = () => reject(new Error("Link preview timed out."));
        if (signal.aborted) return aborted();
        signal.addEventListener("abort", aborted, { once: true });
        lookup(hostname, { all: true })
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", aborted));
      });
  if (signal.aborted) throw new Error("Link preview timed out.");
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Private link preview DNS answer.");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(
      url,
      {
        signal,
        agent: false,
        family: selected.family,
        lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        headers: {
          "User-Agent": "SimplePostLinkPreview/1.0",
          Accept: "text/html,image/*",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
          response.destroy(); // Do not download an unbounded redirect body.
          if (redirects >= 3) return reject(new Error("Too many link preview redirects."));
          let target: string;
          try {
            target = new URL(response.headers.location, url).href;
          } catch {
            reject(new Error("Invalid link preview redirect."));
            return;
          }
          fetchCardResource(target, signal, redirects + 1).then(resolve, reject);
          return;
        }
        if (status !== 200 || Number(response.headers["content-length"] ?? 0) > MAX_BYTES) {
          response.destroy();
          reject(new Error("Invalid or oversized link preview response."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            response.destroy(new Error("Oversized link preview response."));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({ body: Buffer.concat(chunks), url, contentType: String(response.headers["content-type"] ?? "") }),
        );
      },
    );
    request.on("error", reject);
    request.setTimeout(3000, () => request.destroy(new Error("Link preview timed out.")));
  });
}
