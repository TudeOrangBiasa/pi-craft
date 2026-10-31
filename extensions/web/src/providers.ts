// Search provider contract. Every built-in provider implements this, and
// registerSearchProvider lets agents add their own without touching core.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
}

export type RecencyFilter = "day" | "week" | "month" | "year";

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: RecencyFilter;
  /** Domains to keep (prefix with "-" to exclude). Providers that cannot filter natively get post-filtering in search(). */
  domainFilter?: string[];
  signal?: AbortSignal;
  /** Test seam: replaces global fetch. */
  fetchImpl?: typeof fetch;
}

export interface SearchProvider {
  /** Lowercase id, used in the `provider` tool param and the fallback chain. */
  readonly name: string;
  /** False when the provider cannot run (missing key, missing base URL). search() still throws a helpful error. */
  isAvailable(): boolean;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

const registry = new Map<string, SearchProvider>();

/**
 * Add a provider, or replace one with the same name. Names are lowercase ids:
 * letters, digits, hyphens. Throws on anything else so typos fail loudly.
 */
export function registerSearchProvider(provider: SearchProvider): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider.name)) {
    throw new Error(
      `Invalid provider name "${provider.name}": use lowercase letters, digits, hyphens`,
    );
  }
  registry.set(provider.name, provider);
}

export function getSearchProvider(name: string): SearchProvider | undefined {
  return registry.get(name);
}

/** Built-in plus registered providers, in registration order. */
export function listSearchProviders(): SearchProvider[] {
  return [...registry.values()];
}

/** Names only, for the tool schema and status output. */
export function listSearchProviderNames(): string[] {
  return [...registry.keys()];
}

function normalizeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(Math.floor(value), 20));
}

function normalizeDomain(value: string): string | null {
  let input = value.trim().toLowerCase();
  if (input.startsWith("-")) input = input.slice(1).trim();
  if (!input) return null;
  try {
    input = new URL(input.includes("://") ? input : `https://${input}`).hostname;
  } catch {
    input = input.split("/")[0]?.split(":")[0] ?? "";
  }
  input = input.replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

function splitDomainFilters(domainFilter: string[] | undefined): {
  allowed: string[];
  blocked: string[];
} {
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const raw of domainFilter ?? []) {
    const domain = normalizeDomain(raw);
    if (!domain) continue;
    (raw.trim().startsWith("-") ? blocked : allowed).push(domain);
  }
  return { allowed, blocked };
}

function matchesDomainFilters(
  url: string,
  filters: { allowed: string[]; blocked: string[] },
): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hit = (domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
  if (filters.blocked.some(hit)) return false;
  return filters.allowed.length === 0 || filters.allowed.some(hit);
}

export interface SearchCall {
  provider: string;
  response: SearchResponse;
}

/**
 * Run one provider. Applies numResults clamping and domain post-filtering so
 * custom providers can skip both and still behave like built-ins.
 */
export async function search(
  providerName: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchCall> {
  const provider = registry.get(providerName);
  if (!provider) {
    throw new Error(
      `Unknown search provider "${providerName}" (available: ${listSearchProviderNames().join(", ") || "none"})`,
    );
  }
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Search query must not be empty");
  const response = await provider.search(trimmed, options);
  const filters = splitDomainFilters(options.domainFilter);
  const limit = normalizeCount(options.numResults);
  const results = options.domainFilter?.length
    ? response.results.filter((r) => matchesDomainFilters(r.url, filters)).slice(0, limit)
    : response.results.slice(0, limit);
  return { provider: providerName, response: { answer: response.answer, results } };
}

export interface FallbackResult extends SearchCall {
  errors: Array<{ provider: string; error: string }>;
}

/**
 * Try each provider in order, return the first success. Throws the collected
 * errors when every provider fails.
 */
export async function searchWithFallback(
  providerNames: string[],
  query: string,
  options: SearchOptions = {},
): Promise<FallbackResult> {
  const errors: Array<{ provider: string; error: string }> = [];
  for (const name of providerNames) {
    try {
      const call = await search(name, query, options);
      return { ...call, errors };
    } catch (err) {
      errors.push({ provider: name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const detail =
    errors.map((e) => `${e.provider}: ${e.error}`).join("; ") || "no providers configured";
  throw new Error(`All search providers failed: ${detail}`);
}
