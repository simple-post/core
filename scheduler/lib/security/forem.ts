import dns from "node:dns";
import net from "node:net";

import { Agent } from "undici";

const MAX_REDIRECTS = 5;

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const clean = address.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (net.isIPv4(clean)) return isPrivateIPv4(clean.split(".").map(Number));
  if (!net.isIPv6(clean)) return false;

  const mapped = /^::ffff:(.+)$/.exec(clean);
  if (mapped && net.isIPv4(mapped[1])) return isPrivateIPv4(mapped[1].split(".").map(Number));
  if (mapped) {
    const groups = mapped[1].split(":");
    if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
      const value = (Number.parseInt(groups[0], 16) << 16) | Number.parseInt(groups[1], 16);
      return isPrivateIPv4([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
    }
  }

  return (
    clean === "::" ||
    clean === "::1" ||
    /^fe[89ab][0-9a-f]:/.test(clean) ||
    /^f[cd][0-9a-f]{2}:/.test(clean) ||
    /^ff[0-9a-f]{2}:/.test(clean)
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    /^metadata\./.test(normalized) ||
    /^internal\./.test(normalized) ||
    /\.internal$/.test(normalized)
  );
}

export function normalizeForemInstanceUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Forem instance URL must be a valid https:// origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Forem instance URL must be a valid https:// origin");
  }
  if (isBlockedHostname(parsed.hostname) || isPrivateAddress(parsed.hostname)) {
    throw new Error("Forem instance URL must not point at localhost, private networks, or metadata endpoints");
  }
  return parsed.origin;
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = resolved.find(({ address }) => isPrivateAddress(address));
    if (blocked) {
      callback(new Error(`Forem hostname resolved to a private/internal address: ${hostname}`), "", 0);
      return;
    }
    const first = resolved[0];
    if (options.all) callback(null, resolved);
    else callback(null, first.address, first.family);
  });
}

const foremDispatcher = new Agent({ connect: { lookup: safeLookup } });

export async function fetchForem(instanceUrl: string, path: string, init: RequestInit): Promise<Response> {
  const origin = normalizeForemInstanceUrl(instanceUrl);
  let currentUrl = new URL(path, `${origin}/`).toString();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    normalizeForemInstanceUrl(new URL(currentUrl).origin);
    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      dispatcher: foremDispatcher,
    } as RequestInit & { dispatcher: Agent });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    const redirectUrl = new URL(location, currentUrl);
    const redirectOrigin = normalizeForemInstanceUrl(redirectUrl.origin);
    if (redirectOrigin !== origin) {
      throw new Error("Forem API redirects must remain on the configured instance origin");
    }
    currentUrl = redirectUrl.toString();
  }
  throw new Error(`Forem endpoint redirected more than ${MAX_REDIRECTS} times`);
}
