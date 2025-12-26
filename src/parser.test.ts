import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { EmailParser } from './parser.js';

describe('EmailParser', () => {
  const parser = new EmailParser();

  describe('stripHtml', () => {
    /**
     * **Feature: yahoo-mail-extractor, Property 7: HTML Strip Consistency**
     * *For any* HTML content, stripping HTML tags should produce text that 
     * contains no HTML tag characters (< or >) except in text content.
     * **Validates: Requirements 3.6**
     */
    it('stripped HTML contains no HTML tags', () => {
      // Generate arbitrary HTML-like content with tags
      const htmlTagArb = fc.tuple(
        fc.constantFrom('div', 'span', 'p', 'a', 'b', 'i', 'strong', 'em', 'br', 'hr', 'img', 'table', 'tr', 'td'),
        fc.dictionary(
          fc.constantFrom('class', 'id', 'href', 'src', 'style'),
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('"') && !s.includes('<') && !s.includes('>'))
        )
      ).map(([tag, attrs]) => {
        const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
        return attrStr ? `<${tag} ${attrStr}>` : `<${tag}>`;
      });

      // Generate text content that doesn't contain < or > (valid text between tags)
      const textContentArb = fc.string({ minLength: 0, maxLength: 50 })
        .filter(s => !s.includes('<') && !s.includes('>'));

      // Generate HTML document with mixed tags and text
      const htmlDocArb = fc.array(
        fc.oneof(
          htmlTagArb,
          fc.constantFrom('</div>', '</span>', '</p>', '</a>', '</b>', '</i>', '</strong>', '</em>', '</table>', '</tr>', '</td>'),
          textContentArb
        ),
        { minLength: 1, maxLength: 20 }
      ).map(parts => parts.join(''));

      fc.assert(
        fc.property(htmlDocArb, (html) => {
          const stripped = parser.stripHtml(html);
          
          // The stripped result should not contain any HTML tags
          // HTML tags are defined as < followed by tag content and >
          const hasHtmlTags = /<[a-zA-Z][^>]*>|<\/[a-zA-Z][^>]*>/g.test(stripped);
          
          expect(hasHtmlTags).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('preserves text content between tags', () => {
      // Generate text that doesn't contain HTML special chars
      const safeTextArb = fc.string({ minLength: 1, maxLength: 30 })
        .filter(s => !s.includes('<') && !s.includes('>') && !s.includes('&') && s.trim().length > 0);

      fc.assert(
        fc.property(safeTextArb, (text) => {
          // Wrap text in various HTML tags
          const html = `<div><p>${text}</p></div>`;
          const stripped = parser.stripHtml(html);
          
          // The stripped result should contain the original text
          expect(stripped).toContain(text.trim());
        }),
        { numRuns: 100 }
      );
    });

    it('removes script and style blocks completely', () => {
      // Generate content that is non-trivial and won't appear in the visible text
      // Filter out substrings of "visible" and "also visible"
      const visibleText = 'visiblealso visible';
      const scriptContentArb = fc.string({ minLength: 2, maxLength: 50 })
        .filter(s => 
          !s.includes('</script>') && 
          !s.includes('</style>') && 
          s.trim().length > 1 &&
          !visibleText.includes(s) &&  // Content should not be a substring of visible text
          !s.includes('visible') &&     // Content should not contain 'visible'
          !s.includes('also')           // Content should not contain 'also'
        );

      fc.assert(
        fc.property(scriptContentArb, (content) => {
          const htmlWithScript = `<div>visible</div><script>${content}</script><style>${content}</style><p>also visible</p>`;
          const stripped = parser.stripHtml(htmlWithScript);
          
          // Script/style content should be removed (for non-trivial content)
          expect(stripped).not.toContain(content);
          // But regular content should remain
          expect(stripped).toContain('visible');
          expect(stripped).toContain('also visible');
        }),
        { numRuns: 100 }
      );
    });

    it('handles empty and whitespace input', () => {
      expect(parser.stripHtml('')).toBe('');
      expect(parser.stripHtml('   ')).toBe('');
      expect(parser.stripHtml('\n\t')).toBe('');
    });

    it('decodes HTML entities correctly', () => {
      const testCases = [
        { input: 'a&amp;b', expected: 'a&b' },
        { input: 'a&lt;b', expected: 'a<b' },
        { input: 'a&gt;b', expected: 'a>b' },
        { input: 'a&quot;b', expected: 'a"b' },
        { input: 'a&nbsp;b', expected: 'a b' },
        { input: '&#65;', expected: 'A' },
        { input: '&#x41;', expected: 'A' },
      ];

      for (const { input, expected } of testCases) {
        expect(parser.stripHtml(input)).toBe(expected);
      }
    });
  });

  describe('parse', () => {
    it('parses simple plain text email', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
        'To: recipient@example.com\r\n' +
        'Subject: Test Subject\r\n' +
        'Date: Mon, 01 Jan 2024 12:00:00 +0000\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'This is the email body.'
      );

      const parsed = await parser.parse(rawEmail, 123);

      expect(parsed.uid).toBe(123);
      expect(parsed.from).toBe('sender@example.com');
      expect(parsed.subject).toBe('Test Subject');
      expect(parsed.textContent).toContain('This is the email body.');
    });

    it('parses HTML email and extracts content', async () => {
      const rawEmail = Buffer.from(
        'From: sender@example.com\r\n' +
        'To: recipient@example.com\r\n' +
        'Subject: HTML Test\r\n' +
        'Date: Mon, 01 Jan 2024 12:00:00 +0000\r\n' +
        'Content-Type: text/html\r\n' +
        '\r\n' +
        '<html><body><p>Hello World</p></body></html>'
      );

      const parsed = await parser.parse(rawEmail, 456);

      expect(parsed.uid).toBe(456);
      expect(parsed.subject).toBe('HTML Test');
      expect(parsed.htmlContent).toContain('<p>Hello World</p>');
    });
  });
});
