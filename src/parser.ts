// Email Parser - Parses raw email content and handles HTML stripping
import { simpleParser, ParsedMail } from 'mailparser';
import type { ParsedEmail } from './types.js';

/**
 * EmailParser handles parsing of raw email content using mailparser
 * and provides HTML stripping functionality for text extraction.
 */
export class EmailParser {
  /**
   * Parse raw email buffer into a structured ParsedEmail object.
   * Handles both plain text and HTML email formats.
   * 
   * @param raw - Raw email content as Buffer
   * @param uid - Unique identifier for the email
   * @returns ParsedEmail object with extracted content
   */
  async parse(raw: Buffer, uid: number = 0): Promise<ParsedEmail> {
    const parsed: ParsedMail = await simpleParser(raw);

    const from = this.extractFromAddress(parsed);
    const to = this.extractToAddress(parsed);
    const subject = parsed.subject || '';
    const date = parsed.date || new Date();
    const textContent = parsed.text || '';
    const htmlContent = typeof parsed.html === 'string' ? parsed.html : undefined;

    return {
      uid,
      date,
      from,
      to,
      subject,
      textContent,
      htmlContent,
    };
  }

  /**
   * Strip HTML tags from content, preserving text content.
   * Handles various HTML constructs including:
   * - Regular HTML tags
   * - Self-closing tags
   * - HTML comments
   * - Script and style blocks
   * - HTML entities (decoded to text)
   * 
   * @param html - HTML content to strip
   * @returns Plain text with HTML tags removed
   */
  stripHtml(html: string): string {
    if (!html) {
      return '';
    }

    let result = html;

    // Remove script and style blocks entirely (including content)
    result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML comments
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    // Remove all HTML tags
    result = result.replace(/<[^>]*>/g, '');

    // Decode common HTML entities
    result = this.decodeHtmlEntities(result);

    // Normalize whitespace (collapse multiple spaces/newlines)
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Decode common HTML entities to their text equivalents.
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&nbsp;': ' ',
      '&copy;': '\u00A9',
      '&reg;': '\u00AE',
      '&trade;': '\u2122',
      '&mdash;': '\u2014',
      '&ndash;': '\u2013',
      '&hellip;': '\u2026',
      '&lsquo;': '\u2018',
      '&rsquo;': '\u2019',
      '&ldquo;': '\u201C',
      '&rdquo;': '\u201D',
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'g'), char);
    }

    // Handle numeric entities (&#123; or &#x1F;)
    result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

    return result;
  }

  /**
   * Extract the from address from parsed mail.
   */
  private extractFromAddress(parsed: ParsedMail): string {
    if (parsed.from?.value && parsed.from.value.length > 0) {
      const addr = parsed.from.value[0];
      return addr.address || addr.name || '';
    }
    return '';
  }

  /**
   * Extract the to address from parsed mail.
   */
  private extractToAddress(parsed: ParsedMail): string {
    if (parsed.to) {
      const toField = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
      if (toField?.value && toField.value.length > 0) {
        const addr = toField.value[0];
        return addr.address || addr.name || '';
      }
    }
    return '';
  }
}
