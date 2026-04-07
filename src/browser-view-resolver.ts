import { EmailParser } from './parser.js';

const SUPPORTED_BROWSER_VIEW_HOST_PREFIXES = ['click.email.', 'view.email.'];
const URL_REGEX = /https?:\/\/[^\s"'<>)]*/gi;
const MAX_BROWSER_VIEW_URLS = 2;
const FETCH_TIMEOUT_MS = 10000;
const MAX_REMOTE_HTML_LENGTH = 500000;

export async function resolveBrowserViewSearchableText(
  textContent: string,
  htmlContent: string | undefined,
  parser: EmailParser,
  enabled: boolean = false
): Promise<string> {
  const baseSearchableText = parser.buildSearchableText(textContent, htmlContent);

  if (!enabled) {
    return baseSearchableText;
  }

  const browserViewUrls = extractBrowserViewUrls(baseSearchableText).slice(0, MAX_BROWSER_VIEW_URLS);

  if (browserViewUrls.length === 0) {
    return baseSearchableText;
  }

  const segments = [baseSearchableText];

  for (const url of browserViewUrls) {
    const resolvedText = await fetchBrowserViewText(url, parser);
    if (resolvedText) {
      segments.push(resolvedText);
    }
  }

  return joinUniqueSegments(segments);
}

function extractBrowserViewUrls(content: string): string[] {
  const urls = new Set<string>();

  for (const match of content.matchAll(URL_REGEX)) {
    const candidate = trimTrailingPunctuation(match[0]);
    if (isSupportedBrowserViewUrl(candidate)) {
      urls.add(candidate);
    }
  }

  return [...urls];
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;]+$/g, '');
}

function isSupportedBrowserViewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return SUPPORTED_BROWSER_VIEW_HOST_PREFIXES.some(prefix => hostname.startsWith(prefix));
  } catch {
    return false;
  }
}

async function fetchBrowserViewText(url: string, parser: EmailParser): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'YahooMailExtractor/1.0',
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return null;
    }

    const html = (await response.text()).slice(0, MAX_REMOTE_HTML_LENGTH);
    const stripped = parser.stripHtml(html);

    return stripped || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function joinUniqueSegments(values: string[]): string {
  const normalized = new Set<string>();
  const segments: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || normalized.has(trimmed)) {
      continue;
    }

    normalized.add(trimmed);
    segments.push(trimmed);
  }

  return segments.join('\n\n');
}
