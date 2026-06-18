export function normalizeEventUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Invalid URL. Please enter a valid event website URL.");
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    throw new Error("Invalid URL. Please enter a valid event website URL.");
  }

  return parsed.toString().replace(/\/$/, "");
}
