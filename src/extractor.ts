// Regex Extractor - Extracts information from email content using regex patterns
import type { ParsedEmail, ExtractionPattern, ExtractionMatch, ExtractionResult } from './types.js';
import { EmailParser } from './parser.js';

/**
 * RegexExtractor extracts information from email content using regex patterns.
 * Supports named capture groups and batch processing.
 */
export class RegexExtractor {
  private parser: EmailParser;

  constructor() {
    this.parser = new EmailParser();
  }

  /**
   * Extract matches from a single email using the provided pattern.
   * 
   * @param email - Parsed email to extract from
   * @param pattern - Extraction pattern with regex
   * @param stripHtml - Whether to strip HTML tags before extraction (default: false)
   * @returns ExtractionResult with all matches found
   */
  extract(email: ParsedEmail, pattern: ExtractionPattern, stripHtml: boolean = false): ExtractionResult {
    const matches: ExtractionMatch[] = [];
    
    try {
      // Determine content to search
      let content = email.textContent;
      
      // If HTML content exists and stripHtml is enabled, use stripped HTML
      if (stripHtml && email.htmlContent) {
        content = this.parser.stripHtml(email.htmlContent);
      } else if (!content && email.htmlContent) {
        // Fallback to HTML content if no text content
        content = stripHtml ? this.parser.stripHtml(email.htmlContent) : email.htmlContent;
      }

      if (!content) {
        return { email, matches: [], patternName: pattern.name };
      }

      // Create regex from pattern
      const regex = this.createRegex(pattern);
      
      // Find all matches with safety limits
      let match: RegExpExecArray | null;
      const maxMatches = 1000; // Prevent runaway matching
      const maxContentLength = 500000; // 500KB limit
      
      // Truncate very long content to prevent catastrophic backtracking
      const safeContent = content.length > maxContentLength 
        ? content.substring(0, maxContentLength) 
        : content;
      
      // For global flag, iterate through all matches
      if (regex.global) {
        let matchCount = 0;
        while ((match = regex.exec(safeContent)) !== null && matchCount < maxMatches) {
          matches.push(this.createExtractionMatch(match));
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
          matches.push(this.createExtractionMatch(match));
        }
      }
    } catch (error) {
      // Handle extraction errors gracefully - return empty matches
      // The error is logged but processing continues
      console.warn(`Extraction error for email ${email.uid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      email,
      matches,
      patternName: pattern.name,
    };
  }


  /**
   * Extract matches from multiple emails using the provided pattern.
   * Processes each email independently, continuing even if some fail.
   * 
   * @param emails - Array of parsed emails to extract from
   * @param pattern - Extraction pattern with regex
   * @param stripHtml - Whether to strip HTML tags before extraction (default: false)
   * @returns Array of ExtractionResults, one per email
   */
  extractBatch(emails: ParsedEmail[], pattern: ExtractionPattern, stripHtml: boolean = false): ExtractionResult[] {
    return emails.map(email => this.extract(email, pattern, stripHtml));
  }

  /**
   * Create a RegExp object from an ExtractionPattern.
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
   * Create an ExtractionMatch from a RegExpExecArray result.
   * Extracts named capture groups from the match.
   * 
   * @param match - The regex match result
   * @returns ExtractionMatch with full match and named groups
   */
  private createExtractionMatch(match: RegExpExecArray): ExtractionMatch {
    const groups: Record<string, string> = {};
    
    // Extract named capture groups
    if (match.groups) {
      for (const [key, value] of Object.entries(match.groups)) {
        // Only include groups that matched (not undefined)
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
