/** Alternate URLs to try when the primary event URL is blocked or unreachable. */
export function eventUrlVariants(eventUrl: string): string[] {
  const variants: string[] = [];

  try {
    const parsed = new URL(eventUrl);
    const normalized = parsed.toString().replace(/\/$/, "");
    variants.push(normalized);

    const host = parsed.hostname;
    if (host.startsWith("www.")) {
      parsed.hostname = host.slice(4);
      variants.push(parsed.toString().replace(/\/$/, ""));
    } else {
      parsed.hostname = `www.${host}`;
      variants.push(parsed.toString().replace(/\/$/, ""));
    }

    const base = new URL(normalized);
    for (const path of ["/en", "/en-us", "/home"]) {
      const withPath = new URL(path, base.origin);
      withPath.search = "";
      withPath.hash = "";
      variants.push(withPath.toString().replace(/\/$/, ""));
    }
  } catch {
    variants.push(eventUrl);
  }

  return [...new Set(variants)];
}
