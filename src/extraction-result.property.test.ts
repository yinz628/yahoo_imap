import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RegexExtractor } from './extractor.js';
import type { ParsedEmail, ExtractionPattern, ExtractionResult } from './types.js';

describe('Extraction Result Completeness', () => {
  const extractor = new RegexExtractor();

  // Arbitrary for creating ParsedEmail objects
  const parsedEmailArbitrary = fc.record({
    uid: fc.integer({ min: 1, max: 1000000 }),
    date: fc.date(),
    from: fc.tuple(
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9]+$/.test(s))
    ).map(([user, domain]) => `${user}@${domain}.com`),
    subject: fc.string({ minLength: 1, maxLength: 100 }),
    textContent: fc.string({ minLength: 0, maxLength: 500 }),
    htmlContent: fc.oneof(
      fc.constant(undefined),
      fc.string({ minLength: 0, maxLength: 500 })
    ),
  }).map(obj => ({
    uid: obj.uid,
    date: obj.date,
    from: obj.from,
    subject: obj.subject,
    textContent: obj.textContent,
    htmlContent: obj.htmlContent,
  }));

  // Arbitrary for creating simple patterns that will match
  const simplePatternArbitrary = fc.string({ minLength: 2, maxLength: 10 })
    .filter(s => /^[a-zA-Z]+$/.test(s))
    .map(word => ({
      name: 'test-pattern',
      pattern: word,
      flags: 'g',
    }));

  /**
   * **Feature: discount-code-extraction-workflow, Property 12: Extraction Result Completeness**
   * *For any* extraction operation with a valid rule, all extracted codes should include 
   * their source email information (subject, date, from).
   * **Validates: Requirements 5.2, 5.3**
   */
  it('extraction results include complete source email information', () => {
    fc.assert(
      fc.property(parsedEmailArbitrary, simplePatternArbitrary, (email, pattern) => {
        // Create content that will match the pattern
        const matchWord = pattern.pattern;
        const content = `Here is a code: ${matchWord} and another: ${matchWord}`;
        
        const testEmail: ParsedEmail = {
          ...email,
          textContent: content,
        };

        const result: ExtractionResult = extractor.extract(testEmail, pattern as ExtractionPattern);

        // If there are matches, verify they include source email info
        if (result.matches.length > 0) {
          // Result should have email property with all required fields
          expect(result.email).toBeDefined();
          expect(result.email.subject).toBeDefined();
          expect(result.email.date).toBeDefined();
          expect(result.email.from).toBeDefined();
          
          // Email information should match what we provided
          expect(result.email.subject).toBe(email.subject);
          expect(result.email.date).toEqual(email.date);
          expect(result.email.from).toBe(email.from);
          
          // Pattern name should be preserved
          expect(result.patternName).toBe(pattern.name);
          
          // Each match should have required fields
          for (const match of result.matches) {
            expect(match.fullMatch).toBeDefined();
            expect(match.fullMatch.length).toBeGreaterThan(0);
            expect(match.groups).toBeDefined();
            expect(typeof match.groups).toBe('object');
            expect(match.index).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: discount-code-extraction-workflow, Property 12: Extraction Result Completeness (Edge Case)**
   * *For any* extraction operation that finds no matches, the result should still include 
   * the source email information with an empty matches array.
   * **Validates: Requirements 5.2, 5.3**
   */
  it('extraction results include email info even when no matches found', () => {
    fc.assert(
      fc.property(parsedEmailArbitrary, (email) => {
        const testEmail: ParsedEmail = {
          ...email,
          textContent: 'This content has no matches',
        };

        const pattern: ExtractionPattern = {
          name: 'no-match-pattern',
          pattern: 'XYZABC123NOTFOUND',
          flags: 'g',
        };

        const result: ExtractionResult = extractor.extract(testEmail, pattern);

        // Even with no matches, email info should be present
        expect(result.email).toBeDefined();
        expect(result.email.subject).toBe(email.subject);
        expect(result.email.date).toEqual(email.date);
        expect(result.email.from).toBe(email.from);
        expect(result.matches).toHaveLength(0);
        expect(result.patternName).toBe('no-match-pattern');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: discount-code-extraction-workflow, Property 12: Extraction Result Completeness (Multiple Matches)**
   * *For any* extraction operation with multiple matches, all matches should be included 
   * in the results with the same source email information.
   * **Validates: Requirements 5.2, 5.3**
   */
  it('all matches are included with consistent source email information', () => {
    fc.assert(
      fc.property(
        parsedEmailArbitrary,
        fc.integer({ min: 1, max: 10 }),
        (email, matchCount) => {
          const pattern = 'CODE';
          
          // Create content with multiple matches
          const matches = Array(matchCount).fill('CODE').join(' ');
          const testEmail: ParsedEmail = {
            ...email,
            textContent: `Codes: ${matches}`,
          };

          const extractionPattern: ExtractionPattern = {
            name: 'multi-code-pattern',
            pattern: pattern,
            flags: 'g',
          };

          const result: ExtractionResult = extractor.extract(testEmail, extractionPattern);

          // Should find all matches
          expect(result.matches.length).toBe(matchCount);
          
          // All matches should have the same source email info
          for (const match of result.matches) {
            expect(match.fullMatch).toBe('CODE');
            expect(result.email.subject).toBe(email.subject);
            expect(result.email.date).toEqual(email.date);
            expect(result.email.from).toBe(email.from);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
