/**
 * Property-Based Tests for Email Search Service
 * 
 * Tests the correctness properties defined in the design document
 * for the discount-code-extraction-workflow feature.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  searchInContent,
  highlightMatches,
  navigateMatches,
  type SearchResult,
} from './email-search.js';


// **Feature: discount-code-extraction-workflow, Property 5: Content Search Completeness**
// **Validates: Requirements 2.4**
describe('Property 5: Content Search Completeness', () => {

  it('for any search query and content, the search function should return all occurrences with correct positions', () => {
    fc.assert(
      fc.property(
        // Generate a target string to search for
        fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
        // Generate prefix and suffix content
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        (target, prefix, suffix) => {
          const content = prefix + target + suffix;
          
          const results = searchInContent(content, target);
          
          // Should find at least one match (the target)
          expect(results.length).toBeGreaterThanOrEqual(1);
          
          // Each result should have correct position
          for (const result of results) {
            expect(result.index).toBeGreaterThanOrEqual(0);
            expect(result.index).toBeLessThan(content.length);
            expect(result.length).toBe(target.length);
            
            // The match at the position should equal the target
            const matchedText = content.substring(result.index, result.index + result.length);
            expect(matchedText.toLowerCase()).toBe(target.toLowerCase());
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any content with multiple occurrences of a query, all occurrences should be found', () => {
    fc.assert(
      fc.property(
        // Generate a target string
        fc.stringMatching(/^[A-Za-z0-9]{2,5}$/),
        // Generate number of repetitions (2-5)
        fc.integer({ min: 2, max: 5 }),
        // Generate separator that doesn't contain the target
        fc.stringMatching(/^[_\-\.]{1,3}$/),
        (target, repetitions, separator) => {
          // Create content with multiple occurrences
          const parts = Array(repetitions).fill(target);
          const content = parts.join(separator);
          
          const results = searchInContent(content, target);
          
          // Should find exactly the number of repetitions
          expect(results.length).toBe(repetitions);
          
          // Positions should be in ascending order
          for (let i = 1; i < results.length; i++) {
            expect(results[i].index).toBeGreaterThan(results[i - 1].index);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any content without the query, search should return empty results', () => {
    fc.assert(
      fc.property(
        // Generate content with only lowercase letters
        fc.stringMatching(/^[a-z]{5,20}$/),
        // Generate query with only digits (won't match)
        fc.stringMatching(/^[0-9]{3,8}$/),
        (content, query) => {
          const results = searchInContent(content, query);
          
          expect(results).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('search results should include context around each match', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{3,8}$/),
        fc.stringMatching(/^[A-Za-z0-9]{10,30}$/),
        fc.stringMatching(/^[A-Za-z0-9]{10,30}$/),
        (target, prefix, suffix) => {
          const content = prefix + target + suffix;
          
          const results = searchInContent(content, target, { contextLength: 10 });
          
          expect(results.length).toBeGreaterThanOrEqual(1);
          
          // Each result should have context
          for (const result of results) {
            expect(result.context).toBeDefined();
            expect(result.context.length).toBeGreaterThan(0);
            // Context should contain the target (case-insensitive check)
            expect(result.context.toLowerCase()).toContain(target.toLowerCase());
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('case-insensitive search should find matches regardless of case', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        (lowerTarget) => {
          const upperTarget = lowerTarget.toUpperCase();
          // Use numeric separators to avoid accidental matches within separator text
          const mixedContent = `111 ${upperTarget} 222 ${lowerTarget} 333`;
          
          // Default is case-insensitive
          const results = searchInContent(mixedContent, lowerTarget);
          
          // Should find both occurrences
          expect(results.length).toBe(2);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('case-sensitive search should only find exact case matches', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        (lowerTarget) => {
          const upperTarget = lowerTarget.toUpperCase();
          // Use numeric separators to avoid accidental matches within separator text
          const mixedContent = `111 ${upperTarget} 222 ${lowerTarget} 333`;
          
          // Case-sensitive search
          const results = searchInContent(mixedContent, lowerTarget, { caseSensitive: true });
          
          // Should find only the lowercase occurrence
          expect(results.length).toBe(1);
          
          // The match should be the exact lowercase target
          const matchedText = mixedContent.substring(
            results[0].index, 
            results[0].index + results[0].length
          );
          expect(matchedText).toBe(lowerTarget);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty query should return empty results', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,50}$/),
        (content) => {
          const results = searchInContent(content, '');
          
          expect(results).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty content should return empty results', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
        (query) => {
          const results = searchInContent('', query);
          
          expect(results).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('positions should be valid indices within content bounds', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,50}$/),
        fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
        (content, query) => {
          const results = searchInContent(content, query);
          
          for (const result of results) {
            // Index should be within bounds
            expect(result.index).toBeGreaterThanOrEqual(0);
            expect(result.index + result.length).toBeLessThanOrEqual(content.length);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});



// Additional property tests for highlight functionality
describe('Highlight Matches Properties', () => {

  it('highlight result match count should equal search result count', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,30}$/),
        fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
        (content, query) => {
          const searchResults = searchInContent(content, query);
          const highlightResult = highlightMatches(content, query);
          
          expect(highlightResult.matchCount).toBe(searchResults.length);
          expect(highlightResult.matchPositions.length).toBe(searchResults.length);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('highlight positions should match search result positions', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,30}$/),
        fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
        (content, query) => {
          const searchResults = searchInContent(content, query);
          const highlightResult = highlightMatches(content, query);
          
          // Positions should match
          for (let i = 0; i < searchResults.length; i++) {
            expect(highlightResult.matchPositions[i]).toBe(searchResults[i].index);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('highlighted HTML should contain span elements for each match', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{2,5}$/),
        fc.integer({ min: 1, max: 3 }),
        fc.stringMatching(/^[_\-]{1,2}$/),
        (target, repetitions, separator) => {
          const content = Array(repetitions).fill(target).join(separator);
          const highlightResult = highlightMatches(content, target);
          
          // Count span elements
          const spanMatches = highlightResult.html.match(/<span class="search-highlight"/g);
          
          expect(spanMatches).not.toBeNull();
          expect(spanMatches!.length).toBe(repetitions);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('highlighted HTML should escape special HTML characters', () => {
    const htmlChars = ['<', '>', '&', '"', "'"];
    
    for (const char of htmlChars) {
      const content = `before${char}after`;
      const highlightResult = highlightMatches(content, 'notfound');
      
      // The raw character should not appear in the HTML (should be escaped)
      // Exception: the character might be part of an HTML entity
      if (char === '<') {
        expect(highlightResult.html).not.toContain('<a');
        expect(highlightResult.html).toContain('&lt;');
      } else if (char === '>') {
        expect(highlightResult.html).toContain('&gt;');
      } else if (char === '&') {
        expect(highlightResult.html).toContain('&amp;');
      }
    }
  });

  it('empty query should return escaped content without highlights', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,30}$/),
        (content) => {
          const highlightResult = highlightMatches(content, '');
          
          expect(highlightResult.matchCount).toBe(0);
          expect(highlightResult.matchPositions).toHaveLength(0);
          // HTML should not contain highlight spans
          expect(highlightResult.html).not.toContain('search-highlight');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty content should return empty HTML', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
        (query) => {
          const highlightResult = highlightMatches('', query);
          
          expect(highlightResult.html).toBe('');
          expect(highlightResult.matchCount).toBe(0);
          expect(highlightResult.matchPositions).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Property tests for navigation
describe('Navigate Matches Properties', () => {

  it('next navigation should cycle through all matches', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
        (positions) => {
          // Start at first match
          let currentIndex = 0;
          const visited = new Set<number>();
          
          // Navigate through all matches
          for (let i = 0; i < positions.length; i++) {
            visited.add(currentIndex);
            currentIndex = navigateMatches(positions, currentIndex, 'next');
          }
          
          // Should have visited all positions
          expect(visited.size).toBe(positions.length);
          
          // After full cycle, should be back at start
          expect(currentIndex).toBe(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('prev navigation should cycle through all matches in reverse', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
        (positions) => {
          // Start at first match
          let currentIndex = 0;
          const visited = new Set<number>();
          
          // Navigate backwards through all matches
          for (let i = 0; i < positions.length; i++) {
            visited.add(currentIndex);
            currentIndex = navigateMatches(positions, currentIndex, 'prev');
          }
          
          // Should have visited all positions
          expect(visited.size).toBe(positions.length);
          
          // After full cycle, should be back at start
          expect(currentIndex).toBe(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('navigation with empty positions should return -1', () => {
    expect(navigateMatches([], 0, 'next')).toBe(-1);
    expect(navigateMatches([], 0, 'prev')).toBe(-1);
  });

  it('next from last position should wrap to first', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 10 }),
        (positions) => {
          const lastIndex = positions.length - 1;
          const nextIndex = navigateMatches(positions, lastIndex, 'next');
          
          expect(nextIndex).toBe(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('prev from first position should wrap to last', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 10 }),
        (positions) => {
          const prevIndex = navigateMatches(positions, 0, 'prev');
          
          expect(prevIndex).toBe(positions.length - 1);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('navigation result should always be a valid index', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.constantFrom('next', 'prev') as fc.Arbitrary<'next' | 'prev'>,
        (positions, startIndex, direction) => {
          // Clamp startIndex to valid range
          const validStartIndex = startIndex % positions.length;
          const result = navigateMatches(positions, validStartIndex, direction);
          
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(positions.length);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
