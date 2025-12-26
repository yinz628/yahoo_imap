/**
 * Property-Based Tests for Rule Validation Service
 * 
 * Tests the correctness properties defined in the design document
 * for the discount-code-extraction-workflow feature.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateRuleStructure,
  testRegexMatch,
  hasFieldError,
  getFieldError,
  type PartialRule,
} from './rule-validator.js';
import { escapeSpecialChars } from './regex-generator.js';


// **Feature: discount-code-extraction-workflow, Property 9: Rule Validation Completeness**
// **Validates: Requirements 4.7, 4.8**
describe('Property 9: Rule Validation Completeness', () => {
  
  // Arbitrary for valid rule with all required fields
  const validRuleArbitrary = fc.record({
    patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
    regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/), // Simple valid regex patterns
    regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  });

  it('for any rule missing patternName, validation should reject with clear error indicating missing patternName', () => {
    fc.assert(
      fc.property(
        fc.record({
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/),
          regexFlags: fc.constantFrom('', 'g', 'gi'),
        }),
        (partialRule) => {
          // Rule without patternName
          const result = validateRuleStructure(partialRule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'patternName')).toBe(true);
          
          const errorMsg = getFieldError(result, 'patternName');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('required');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule missing subjectPattern, validation should reject with clear error indicating missing subjectPattern', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/),
          regexFlags: fc.constantFrom('', 'g', 'gi'),
        }),
        (partialRule) => {
          // Rule without subjectPattern
          const result = validateRuleStructure(partialRule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'subjectPattern')).toBe(true);
          
          const errorMsg = getFieldError(result, 'subjectPattern');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('required');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });


  it('for any rule missing regexPattern, validation should reject with clear error indicating missing regexPattern', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexFlags: fc.constantFrom('', 'g', 'gi'),
        }),
        (partialRule) => {
          // Rule without regexPattern
          const result = validateRuleStructure(partialRule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'regexPattern')).toBe(true);
          
          const errorMsg = getFieldError(result, 'regexPattern');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('required');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with empty patternName, validation should reject with clear error', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.constantFrom('', '   ', '\t', '\n'),
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/),
          regexFlags: fc.constantFrom('', 'g', 'gi'),
        }),
        (partialRule) => {
          const result = validateRuleStructure(partialRule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'patternName')).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with empty regexPattern, validation should reject with clear error', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexPattern: fc.constantFrom('', '   ', '\t'),
          regexFlags: fc.constantFrom('', 'g', 'gi'),
        }),
        (partialRule) => {
          const result = validateRuleStructure(partialRule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'regexPattern')).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with wrong type for patternName, validation should reject with type error', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.record({ nested: fc.string() })
        ),
        (wrongType) => {
          const rule: PartialRule = {
            patternName: wrongType,
            subjectPattern: 'test',
            regexPattern: 'test',
          };
          
          const result = validateRuleStructure(rule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'patternName')).toBe(true);
          
          const errorMsg = getFieldError(result, 'patternName');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('string');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with wrong type for subjectPattern, validation should reject with type error', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.record({ nested: fc.string() })
        ),
        (wrongType) => {
          const rule: PartialRule = {
            patternName: 'Test Rule',
            subjectPattern: wrongType,
            regexPattern: 'test',
          };
          
          const result = validateRuleStructure(rule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'subjectPattern')).toBe(true);
          
          const errorMsg = getFieldError(result, 'subjectPattern');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('string');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with wrong type for regexPattern, validation should reject with type error', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.array(fc.string()),
          fc.record({ nested: fc.string() })
        ),
        (wrongType) => {
          const rule: PartialRule = {
            patternName: 'Test Rule',
            subjectPattern: 'test',
            regexPattern: wrongType,
          };
          
          const result = validateRuleStructure(rule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'regexPattern')).toBe(true);
          
          const errorMsg = getFieldError(result, 'regexPattern');
          expect(errorMsg).toBeDefined();
          expect(errorMsg!.toLowerCase()).toContain('string');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any valid rule with all required fields, validation should pass', () => {
    fc.assert(
      fc.property(
        validRuleArbitrary,
        (rule) => {
          const result = validateRuleStructure(rule as PartialRule);
          
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with invalid tags type, validation should reject with clear error', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/),
          tags: fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean()
          ),
        }),
        (rule) => {
          const result = validateRuleStructure(rule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'tags')).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any rule with non-string items in tags array, validation should reject', () => {
    fc.assert(
      fc.property(
        fc.record({
          patternName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          subjectPattern: fc.string({ minLength: 0, maxLength: 100 }),
          regexPattern: fc.stringMatching(/^[a-zA-Z0-9]+$/),
          tags: fc.array(fc.oneof(fc.integer(), fc.boolean()), { minLength: 1, maxLength: 3 }),
        }),
        (rule) => {
          const result = validateRuleStructure(rule as PartialRule);
          
          expect(result.valid).toBe(false);
          expect(hasFieldError(result, 'tags')).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});



// **Feature: discount-code-extraction-workflow, Property 10: Regex Match Correctness**
// **Validates: Requirements 4.3**
describe('Property 10: Regex Match Correctness', () => {

  it('for any valid regex pattern and content, testRegexMatch should return all matches that the regex would find', () => {
    fc.assert(
      fc.property(
        // Generate a target string to search for
        fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
        // Generate prefix and suffix content
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        (target, prefix, suffix) => {
          const content = prefix + target + suffix;
          const escapedTarget = escapeSpecialChars(target);
          
          const result = testRegexMatch(escapedTarget, 'g', content);
          
          // Should find at least one match (the target)
          expect(result.matches.length).toBeGreaterThanOrEqual(1);
          expect(result.matches).toContain(target);
          
          // Positions should be valid indices
          for (const pos of result.positions) {
            expect(pos).toBeGreaterThanOrEqual(0);
            expect(pos).toBeLessThan(content.length);
          }
          
          // Each match should actually exist at its position
          for (let i = 0; i < result.matches.length; i++) {
            const match = result.matches[i];
            const pos = result.positions[i];
            expect(content.substring(pos, pos + match.length)).toBe(match);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any content with multiple occurrences of a pattern, all occurrences should be found', () => {
    fc.assert(
      fc.property(
        // Generate a target string
        fc.stringMatching(/^[A-Za-z0-9]{2,5}$/),
        // Generate number of repetitions (2-5)
        fc.integer({ min: 2, max: 5 }),
        // Generate separator
        fc.stringMatching(/^[_\-\.]{1,3}$/),
        (target, repetitions, separator) => {
          // Create content with multiple occurrences
          const parts = Array(repetitions).fill(target);
          const content = parts.join(separator);
          const escapedTarget = escapeSpecialChars(target);
          
          const result = testRegexMatch(escapedTarget, 'g', content);
          
          // Should find exactly the number of repetitions
          expect(result.matches.length).toBe(repetitions);
          
          // All matches should be the target
          for (const match of result.matches) {
            expect(match).toBe(target);
          }
          
          // Positions should be in ascending order
          for (let i = 1; i < result.positions.length; i++) {
            expect(result.positions[i]).toBeGreaterThan(result.positions[i - 1]);
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any content without the pattern, testRegexMatch should return empty results', () => {
    fc.assert(
      fc.property(
        // Generate content with only lowercase letters
        fc.stringMatching(/^[a-z]{5,20}$/),
        // Generate pattern with only uppercase letters (won't match without 'i' flag)
        fc.stringMatching(/^[A-Z]{3,8}$/),
        (content, pattern) => {
          const escapedPattern = escapeSpecialChars(pattern);
          
          // Without 'i' flag, uppercase pattern won't match lowercase content
          const result = testRegexMatch(escapedPattern, 'g', content);
          
          expect(result.matches).toHaveLength(0);
          expect(result.positions).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('matches and positions arrays should always have the same length', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]{1,30}$/),
        fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/),
        fc.constantFrom('', 'g', 'gi', 'i'),
        (content, pattern, flags) => {
          const result = testRegexMatch(pattern, flags, content);
          
          expect(result.matches.length).toBe(result.positions.length);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for invalid regex patterns, testRegexMatch should return empty results without throwing', () => {
    const invalidPatterns = ['[', '(', '\\', '[z-a]'];
    
    for (const pattern of invalidPatterns) {
      const result = testRegexMatch(pattern, 'g', 'test content');
      
      expect(result.matches).toHaveLength(0);
      expect(result.positions).toHaveLength(0);
    }
  });

  it('for empty pattern, testRegexMatch should return empty results', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]{1,30}$/),
        (content) => {
          const result = testRegexMatch('', 'g', content);
          
          expect(result.matches).toHaveLength(0);
          expect(result.positions).toHaveLength(0);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('case-insensitive flag should find matches regardless of case', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        (lowerTarget) => {
          const upperTarget = lowerTarget.toUpperCase();
          // Use numeric separators to avoid accidental matches within separator text
          const mixedContent = `111 ${upperTarget} 222 ${lowerTarget} 333`;
          const escapedPattern = escapeSpecialChars(lowerTarget);
          
          // With 'i' flag, should find both
          const resultWithI = testRegexMatch(escapedPattern, 'gi', mixedContent);
          expect(resultWithI.matches.length).toBe(2);
          
          // Without 'i' flag, should find only lowercase
          const resultWithoutI = testRegexMatch(escapedPattern, 'g', mixedContent);
          expect(resultWithoutI.matches.length).toBe(1);
          expect(resultWithoutI.matches[0]).toBe(lowerTarget);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('positions should correctly identify where matches start in content', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z]{3,8}$/),
        fc.integer({ min: 0, max: 20 }),
        (target, prefixLength) => {
          const prefix = 'x'.repeat(prefixLength);
          const content = prefix + target;
          const escapedTarget = escapeSpecialChars(target);
          
          const result = testRegexMatch(escapedTarget, 'g', content);
          
          expect(result.matches.length).toBe(1);
          expect(result.positions[0]).toBe(prefixLength);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
