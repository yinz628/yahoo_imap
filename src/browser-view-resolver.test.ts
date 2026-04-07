import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailParser } from './parser.js';
import { resolveBrowserViewSearchableText } from './browser-view-resolver.js';

describe('resolveBrowserViewSearchableText', () => {
  const parser = new EmailParser();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('appends browser-view page text when a supported click.email link is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><body><td>Online: Use code <b>Z64TTVC7G3G6</b></td></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }
      )
    );

    vi.stubGlobal('fetch', fetchMock);

    const searchable = await resolveBrowserViewSearchableText(
      'View this email in a browser https://click.email.bloomingdales.com/?qs=test',
      undefined,
      parser,
      true
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(searchable).toContain('View this email in a browser https://click.email.bloomingdales.com/?qs=test');
    expect(searchable).toContain('Online: Use code Z64TTVC7G3G6');
  });

  it('does not fetch arbitrary links from email content', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchable = await resolveBrowserViewSearchableText(
      'Check this order https://example.com/order?id=123',
      undefined,
      parser
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(searchable).toBe('Check this order https://example.com/order?id=123');
  });

  it('does not fetch browser-view links when the feature is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const searchable = await resolveBrowserViewSearchableText(
      'View this email in a browser https://click.email.bloomingdales.com/?qs=test',
      undefined,
      parser,
      false
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(searchable).toBe('View this email in a browser https://click.email.bloomingdales.com/?qs=test');
  });
});
