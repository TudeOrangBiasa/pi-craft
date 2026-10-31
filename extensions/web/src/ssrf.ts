import net from "node:net";

// SSRF guard for fetch_content: block loopback, link-local, and RFC 1918
// targets unless the user explicitly allows them in the pi-craft.json web section:
//
//   { "fetch": { "allowPrivate": true } }
//
// The guard checks the literal hostname only. It does not resolve DNS, so a
// hostile name that resolves to a private address still gets through. The
// threat it stops is the common one: a page or model output tricking the
// agent into fetching http://127.0.0.1/ or http://169.254.169.254/.

const PRIVATE_V4 = [
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  [0x7f000000, 0xff000000], // 127.0.0.0/8
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
  [0x00000000, 0xff000000], // 0.0.0.0/8
] as const;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = out * 256 + n;
  }
  return out >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4.some(([base, mask]) => (n & mask) >>> 0 === base);
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost") return true;
  const family = net.isIP(host);
  if (family === 4) return isPrivateV4(host);
  if (family === 6) {
    return (
      host === "::1" ||
      host === "::" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    );
  }
  return false;
}

export interface FetchGuardOptions {
  /** Skip the private-target block. Default false. */
  allowPrivate?: boolean;
}

/**
 * Validate a fetch target. Returns the parsed URL, or throws when the URL is
 * malformed, non-HTTP(S), or points at a private target without opt-in.
 */
export function guardFetchUrl(raw: string, options: FetchGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid URL: ${raw.trim().slice(0, 120)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing to fetch non-HTTP(S) URL: ${url.protocol}//${url.host}`);
  }
  if (!options.allowPrivate && isPrivateHostname(url.hostname)) {
    throw new Error(
      `Refusing to fetch private target ${url.host} (set fetch.allowPrivate in the pi-craft.json web section to allow)`,
    );
  }
  return url;
}
