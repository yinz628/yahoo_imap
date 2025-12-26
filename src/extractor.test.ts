import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RegexExtractor } from './extractor.js';
import type { ParsedEmail, ExtractionPattern } from './types.js';

describe('RegexExtractor', () => {
  const extractor = new RegexExtractor();

  // Helper to create a minimal ParsedEmail for testing
  const createEmail = (textContent: string, uid: number = 1): ParsedEmail => ({
    uid,
    date: new Date(),
    from: 'test@example.com',
    subject: 'Test Subject',
    textContent,
    htmlContent: undefined,
  });

  describe('extract', () => {
    /**
     * **Feature: yahoo-mail-extractor, Property 5: Regex Extraction Completeness**
     * *For any* valid regex pattern and email content, the extractor should return 
     * all non-overlapping matches present in the content.
     * **Validates: Requirements 3.1, 3.2**
     */
    it('extracts all non-overlapping matches from content', () => {
      // Generate a simple word to search for (alphanumeric only to avoid regex special chars)
      const wordArb = fc.string({ minLength: 2, maxLength: 8 })
        .filter(s => /^[a-zA-Z]+$/.test(s));
      
      // Generate number of occurrences
      const countArb = fc.integer({ min: 0, max: 10 });
      
      // Generate filler text (without the search word)
      const fillerArb = fc.string({ minLength: 0, maxLength: 20 })
        .filter(s => /^[0-9\s]*$/.test(s)); // Only digits and spaces

      fc.assert(
        fc.property(wordArb, countArb, fillerArb, (word, count, filler) => {
          // Build content with exactly 'count' occurrences of 'word'
          const parts: string[] = [];
          for (let i = 0; i < count; i++) {
            parts.push(filler);
            parts.push(word);
          }
          parts.push(filler);
          const content = parts.join(' ');

          const email = createEmail(content);
          const pattern: ExtractionPattern = {
            name: 'test-pattern',
            pattern: word,
            flags: 'g',
          };

          const result = extractor.extract(email, pattern);

          // Should find exactly 'count' matches
          expect(result.matches.length).toBe(count);
          
          // Each match should be the word we searched for
          for (const match of result.matches) {
            expect(match.fullMatch).toBe(word);
          }
        }),
        { numRuns: 100 }
      );
    });


    it('returns empty matches when pattern not found', () => {
      const email = createEmail('Hello World');
      const pattern: ExtractionPattern = {
        name: 'not-found',
        pattern: 'xyz123',
        flags: 'g',
      };

      const result = extractor.extract(email, pattern);

      expect(result.matches).toHaveLength(0);
      expect(result.email).toBe(email);
      expect(result.patternName).toBe('not-found');
    });

    it('handles empty content gracefully', () => {
      const email = createEmail('');
      const pattern: ExtractionPattern = {
        name: 'test',
        pattern: 'test',
        flags: 'g',
      };

      const result = extractor.extract(email, pattern);

      expect(result.matches).toHaveLength(0);
    });

    it('handles invalid regex pattern gracefully', () => {
      const email = createEmail('test content');
      const pattern: ExtractionPattern = {
        name: 'invalid',
        pattern: '[invalid(regex',
        flags: 'g',
      };

      // Should not throw, returns empty matches
      const result = extractor.extract(email, pattern);
      expect(result.matches).toHaveLength(0);
    });
  });


  describe('named capture groups', () => {
    /**
     * **Feature: yahoo-mail-extractor, Property 6: Named Capture Group Preservation**
     * *For any* regex pattern with named capture groups, the extraction result should 
     * contain all named groups with their correct values.
     * **Validates: Requirements 3.3**
     */
    it('preserves named capture groups with correct values', () => {
      // Generate simple alphanumeric values for capture groups
      const valueArb = fc.string({ minLength: 1, maxLength: 10 })
        .filter(s => /^[a-zA-Z0-9]+$/.test(s));

      fc.assert(
        fc.property(valueArb, valueArb, valueArb, (name, email, code) => {
          // Create content with structured data
          const content = `Name: ${name}, Email: ${email}@test.com, Code: ${code}`;
          
          const parsedEmail = createEmail(content);
          const pattern: ExtractionPattern = {
            name: 'structured-data',
            pattern: 'Name: (?<userName>[^,]+), Email: (?<userEmail>[^,]+), Code: (?<userCode>\\w+)',
            flags: '',
          };

          const result = extractor.extract(parsedEmail, pattern);

          // Should find exactly one match
          expect(result.matches.length).toBe(1);
          
          const match = result.matches[0];
          
          // All named groups should be present
          expect(match.groups).toHaveProperty('userName');
          expect(match.groups).toHaveProperty('userEmail');
          expect(match.groups).toHaveProperty('userCode');
          
          // Values should match what we put in
          expect(match.groups.userName).toBe(name);
          expect(match.groups.userEmail).toBe(`${email}@test.com`);
          expect(match.groups.userCode).toBe(code);
        }),
        { numRuns: 100 }
      );
    });

    it('handles patterns with optional named groups', () => {
      // Test with optional groups that may or may not match
      const email = createEmail('Order: 12345');
      const pattern: ExtractionPattern = {
        name: 'optional-groups',
        pattern: 'Order: (?<orderId>\\d+)(?:, Status: (?<status>\\w+))?',
        flags: '',
      };

      const result = extractor.extract(email, pattern);

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].groups.orderId).toBe('12345');
      // Optional group that didn't match should not be in groups
      expect(result.matches[0].groups.status).toBeUndefined();
    });

    it('handles multiple matches with named groups', () => {
      const email = createEmail('Item: A123, Item: B456, Item: C789');
      const pattern: ExtractionPattern = {
        name: 'multi-match',
        pattern: 'Item: (?<itemCode>[A-Z]\\d+)',
        flags: 'g',
      };

      const result = extractor.extract(email, pattern);

      expect(result.matches.length).toBe(3);
      expect(result.matches[0].groups.itemCode).toBe('A123');
      expect(result.matches[1].groups.itemCode).toBe('B456');
      expect(result.matches[2].groups.itemCode).toBe('C789');
    });
  });


  describe('extractBatch', () => {
    it('processes multiple emails independently', () => {
      const emails = [
        createEmail('Code: ABC123', 1),
        createEmail('Code: DEF456', 2),
        createEmail('No match here', 3),
        createEmail('Code: GHI789', 4),
      ];

      const pattern: ExtractionPattern = {
        name: 'code-pattern',
        pattern: 'Code: (?<code>[A-Z]+\\d+)',
        flags: 'g',
      };

      const results = extractor.extractBatch(emails, pattern);

      expect(results.length).toBe(4);
      expect(results[0].matches.length).toBe(1);
      expect(results[0].matches[0].groups.code).toBe('ABC123');
      expect(results[1].matches.length).toBe(1);
      expect(results[1].matches[0].groups.code).toBe('DEF456');
      expect(results[2].matches.length).toBe(0); // No match
      expect(results[3].matches.length).toBe(1);
      expect(results[3].matches[0].groups.code).toBe('GHI789');
    });
  });

  describe('HTML stripping', () => {
    it('strips HTML before extraction when enabled', () => {
      const email: ParsedEmail = {
        uid: 1,
        date: new Date(),
        from: 'test@example.com',
        subject: 'Test',
        textContent: '',
        htmlContent: '<div>Code: <strong>ABC123</strong></div>',
      };

      const pattern: ExtractionPattern = {
        name: 'code-pattern',
        pattern: 'Code: (?<code>[A-Z]+\\d+)',
        flags: '',
      };

      const result = extractor.extract(email, pattern, true);

      expect(result.matches.length).toBe(1);
      expect(result.matches[0].groups.code).toBe('ABC123');
    });

    it('uses HTML content as fallback when text content is empty', () => {
      const email: ParsedEmail = {
        uid: 1,
        date: new Date(),
        from: 'test@example.com',
        subject: 'Test',
        textContent: '',
        htmlContent: '<p>Order ID: 12345</p>',
      };

      const pattern: ExtractionPattern = {
        name: 'order-pattern',
        pattern: 'Order ID: (?<orderId>\\d+)',
        flags: '',
      };

      // With stripHtml enabled
      const result = extractor.extract(email, pattern, true);
      expect(result.matches.length).toBe(1);
      expect(result.matches[0].groups.orderId).toBe('12345');
    });
  });
});
