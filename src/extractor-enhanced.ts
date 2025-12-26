/**
 * Enhanced Regex Extractor
 * 
 * Extends the basic RegexExtractor with validation, filtering, and streaming capabilities.
 * This version includes:
 * - Match validation
 * - Result filtering
 * - Stream processing for large datasets
 * - Duplicate detection
 */

import type { ParsedEmail, ExtractionPattern, ExtractionMatch, ExtractionResult } from './types.js';
import { EmailParser } from './parser.js';

/**
 * Validator function type for custom match validation
 */
export type MatchValidator = (match: ExtractionMatch) => boolean;

/**
 * Match statistics
 */
export interface MatchStatistics {
  totalMatches: number;
  validMatches: number;
  invalidMatches: number;
  duplicates: number;
  uniqueMatches: Set<string>;
}

/**
 * Enhanced RegexExtractor with validation and filtering
 */
export class EnhancedRegexExtractor {
  private parser: EmailParser;

  constructor() {
    this.parser = new EmailParser();
  }

  /**
   * Extract matches from a single email with validation
   * 
   * @param email - Parsed email to extract from
   * @param pattern - Extraction pattern with regex
   * @param stripHtml - Whether to strip HTML tags before extraction
   * @param validator - Optional custom validator function
   * @returns ExtractionResult with validated matches
   */
  extract(
    email: ParsedEmail,
    pattern: ExtractionPattern,
    stripHtml: boolean = false,
    validator?: MatchValidator
  ): ExtractionResult {
    const matches: ExtractionMatch[] = [];

    try {
      // Determine content to search
      let content = email.textContent;

      if (stripHtml && email.htmlContent) {
        content = this.parser.stripHtml(email.htmlContent);
      } else if (!content && email.htmlContent) {
        content = stripHtml ? this.parser.stripHtml(email.htmlContent) : email.htmlContent;
      }

      if (!content) {
        return { email, matches: [], patternName: pattern.name };
      }

      // Create regex from pattern
      const regex = this.createRegex(pattern);

      // Find all matches with safety limits
      let match: RegExpExecArray | null;
      const maxMatches = 1000;
      const maxContentLength = 500000;

      const safeContent = content.length > maxContentLength
        ? content.substring(0, maxContentLength)
        : content;

      // For global flag, iterate through all matches
      if (regex.global) {
        let matchCount = 0;
        while ((match = regex.exec(safeContent)) !== null && matchCount < maxMatches) {
          const extractionMatch = this.createExtractionMatch(match);

          // Apply validation
          if (!validator || validator(extractionMatch)) {
            matches.push(extractionMatch);
          }

          matchCount++;

          // Prevent infinite loop for zero-length matches
          if (match[0].length === 0) {
            regex.lastIndex++;
          }
        }
      } else {
        // For non-global, just get the first match
        match = regex.exec(safeContent);
        if (match) {
          const extractionMatch = this.createExtractionMatch(match);
          if (!validator || validator(extractionMatch)) {
            matches.push(extractionMatch);
          }
        }
      }
    } catch (error) {
      console.warn(`Extraction error for email ${email.uid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      email,
      matches,
      patternName: pattern.name,
    };
  }

  /**
   * Extract matches from multiple emails with validation
   * 
   * @param emails - Array of parsed emails
   * @param pattern - Extraction pattern
   * @param stripHtml - Whether to strip HTML tags
   * @param validator - Optional custom validator
   * @returns Array of ExtractionResults
   */
  extractBatch(
    emails: ParsedEmail[],
    pattern: ExtractionPattern,
    stripHtml: boolean = false,
    validator?: MatchValidator
  ): ExtractionResult[] {
    return emails.map(email => this.extract(email, pattern, stripHtml, validator));
  }

  /**
   * Stream-based extraction for large datasets
   * 
   * @param emails - Async generator of parsed emails
   * @param pattern - Extraction pattern
   * @param stripHtml - Whether to strip HTML tags
   * @param validator - Optional custom validator
   * @yields ExtractionResults one at a time
   */
  async *extractStream(
    emails: AsyncGenerator<ParsedEmail>,
    pattern: ExtractionPattern,
    stripHtml: boolean = false,
    validator?: MatchValidator
  ): AsyncGenerator<ExtractionResult> {
    for await (const email of emails) {
      yield this.extract(email, pattern, stripHtml, validator);
    }
  }

  /**
   * Filter results to remove duplicates and invalid matches
   * 
   * @param results - Array of extraction results
   * @param removeDuplicates - Whether to remove duplicate matches
   * @returns Filtered results
   */
  filterResults(
    results: ExtractionResult[],
    removeDuplicates: boolean = true
  ): ExtractionResult[] {
    return results.map(result => {
      let matches = result.matches;

      if (removeDuplicates) {
        const seen = new Set<string>();
        matches = matches.filter(match => {
          if (seen.has(match.fullMatch)) {
            return false;
          }
          seen.add(match.fullMatch);
          return true;
        });
      }

      return {
        ...result,
        matches,
      };
    });
  }

  /**
   * Get statistics about extraction results
   * 
   * @param results - Array of extraction results
   * @returns Statistics object
   */
  getStatistics(results: ExtractionResult[]): MatchStatistics {
    const stats: MatchStatistics = {
      totalMatches: 0,
      validMatches: 0,
      invalidMatches: 0,
      duplicates: 0,
      uniqueMatches: new Set(),
    };

    for (const result of results) {
      for (const match of result.matches) {
        stats.totalMatches++;

        if (this.isValidMatch(match)) {
          stats.validMatches++;
        } else {
          stats.invalidMatches++;
        }

        if (stats.uniqueMatches.has(match.fullMatch)) {
          stats.duplicates++;
        } else {
          stats.uniqueMatches.add(match.fullMatch);
        }
      }
    }

    return stats;
  }

  /**
   * Default validation for discount codes
   * 
   * @param match - Match to validate
   * @returns true if valid, false otherwise
   */
  private isValidMatch(match: ExtractionMatch): boolean {
    const code = match.fullMatch;

    // Check length
    if (code.length < 6 || code.length > 12) {
      return false;
    }

    // Check format
    if (!/^[A-Z0-9]+$/.test(code)) {
      return false;
    }

    // Reject pure numbers (usually not valid discount codes)
    if (/^\d+$/.test(code)) {
      return false;
    }

    // Reject pure letters (usually not valid discount codes)
    if (/^[A-Z]+$/.test(code)) {
      return false;
    }

    return true;
  }

  /**
   * Create a RegExp object from an ExtractionPattern
   * 
   * @param pattern - The extraction pattern
   * @returns Compiled RegExp object
   * @throws Error if the pattern is invalid
   */
  private createRegex(pattern: ExtractionPattern): RegExp {
    try {
      return new RegExp(pattern.pattern, pattern.flags || '');
    } catch (error) {
      throw new Error(`Invalid regex pattern "${pattern.pattern}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create an ExtractionMatch from a RegExpExecArray result
   * 
   * @param match - The regex match result
   * @returns ExtractionMatch with full match and named groups
   */
  private createExtractionMatch(match: RegExpExecArray): ExtractionMatch {
    const groups: Record<string, string> = {};

    if (match.groups) {
      for (const [key, value] of Object.entries(match.groups)) {
        if (value !== undefined) {
          groups[key] = value;
        }
      }
    }

    return {
      fullMatch: match[0],
      groups,
      index: match.index,
    };
  }
}

/**
 * Predefined validators for common use cases
 */
export const VALIDATORS = {
  /**
   * Discount code validator
   * Ensures the match looks like a valid discount code
   */
  discountCode: (match: ExtractionMatch): boolean => {
    const code = match.fullMatch;

    // Must be 6-12 characters
    if (code.length < 6 || code.length > 12) {
      return false;
    }

    // Must be alphanumeric
    if (!/^[A-Z0-9]+$/.test(code)) {
      return false;
    }

    // Must not be pure numbers
    if (/^\d+$/.test(code)) {
      return false;
    }

    // Must not be pure letters
    if (/^[A-Z]+$/.test(code)) {
      return false;
    }

    // Must have at least one letter
    if (!/[A-Z]/.test(code)) {
      return false;
    }

    return true;
  },

  /**
   * Email validator
   * Ensures the match is a valid email address
   */
  email: (match: ExtractionMatch): boolean => {
    const email = match.fullMatch;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  /**
   * Phone validator
   * Ensures the match is a valid phone number
   */
  phone: (match: ExtractionMatch): boolean => {
    const phone = match.fullMatch;
    // Remove common separators
    const cleaned = phone.replace(/[\s\-().]/g, '');
    // Should be 10 digits for US format
    return /^\d{10}$/.test(cleaned);
  },

  /**
   * Price validator
   * Ensures the match is a valid price
   */
  price: (match: ExtractionMatch): boolean => {
    const price = match.fullMatch;
    // Should start with $ and contain digits
    return /^\$\d+/.test(price);
  },
};
