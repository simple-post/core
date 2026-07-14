import dns from "node:dns";
import net from "node:net";

import type { AxiosRequestConfig } from "axios";

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

type SafeLookup = NonNullable<AxiosRequestConfig["lookup"]>;

export const foremSafeLookup: SafeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = resolved.find(({ address }) => isPrivateAddress(address));
    if (blocked) {
      callback(new Error(`Forem hostname resolved to a private/internal address: ${hostname}`), []);
      return;
    }
    callback(null, resolved as Parameters<typeof callback>[1]);
  });
};

export function validateForemRedirect(options: Record<string, unknown>, expectedOrigin: string): void {
  const redirectUrl =
    typeof options.href === "string"
      ? options.href
      : `${String(options.protocol)}//${String(options.hostname)}${String(options.path ?? "")}`;
  const parsed = new URL(redirectUrl);
  const redirectOrigin = normalizeForemInstanceUrl(parsed.origin);
  if (redirectOrigin !== expectedOrigin) {
    throw new Error("Forem API redirects must remain on the configured instance origin");
  }
}
