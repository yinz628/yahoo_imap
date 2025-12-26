/**
 * Property-Based Tests for Regex Generator Service
 * 
 * Tests the correctness properties defined in the design document
 * for the discount-code-extraction-workflow feature.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  escapeSpecialChars,
  generateFromTarget,
  suggestPatterns,
  validateRegex,
  testRegexMatch,
} from './regex-generator.js';


// **Feature: discount-code-extraction-workflow, Property 6: Regex Generation Correctness**
// **Validates: Requirements 3.1**
describe('Property 6: Regex Generation Correctness', () => {
  it('for any target string, the generated literal regex pattern should match the original target string when applied', () => {
    fc.assert(
      fc.property(
        // Use printable ASCII strings to avoid regex edge cases with control characters
        fc.stringMatching(/^[\x20-\x7E]{1,50}$/),
        (target) => {
          const result = generateFromTarget(target);
          
          // The literal pattern should be a valid regex
          const validation = validateRegex(result.literal);
          expect(validation.valid).toBe(true);
          
          // The literal pattern should match the original target
          const regex = new RegExp(result.literal);
          expect(regex.test(target)).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any alphanumeric target string, the generated pattern should match the exact target', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
        (target) => {
          const result = generateFromTarget(target);
          
          // Literal pattern should match exactly
          const regex = new RegExp(`^${result.literal}$`);
          expect(regex.test(target)).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('generated pattern should find the target within larger content', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        fc.stringMatching(/^[A-Za-z0-9]{0,20}$/),
        (target, prefix, suffix) => {
          const content = prefix + target + suffix;
          const result = generateFromTarget(target);
          
          const regex = new RegExp(result.literal, 'g');
          const matches = content.match(regex);
          
          // Should find at least one match (the target itself)
          expect(matches).not.toBeNull();
          expect(matches!.length).toBeGreaterThanOrEqual(1);
          expect(matches).toContain(target);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});



// **Feature: discount-code-extraction-workflow, Property 7: Special Character Escaping**
// **Validates: Requirements 3.2**
describe('Property 7: Special Character Escaping', () => {
  // All regex special characters that need escaping
  const specialChars = ['.', '*', '+', '?', '^', '$', '{', '}', '[', ']', '\\', '|', '(', ')'];
  
  it('for any string containing regex special characters, the escape function should produce a pattern that matches the literal string', () => {
    fc.assert(
      fc.property(
        // Generate strings that include special characters mixed with alphanumeric
        fc.array(
          fc.oneof(
            fc.constantFrom(...specialChars),
            fc.stringMatching(/^[A-Za-z0-9]$/)
          ),
          { minLength: 1, maxLength: 30 }
        ).map(chars => chars.join('')),
        (input) => {
          const escaped = escapeSpecialChars(input);
          
          // The escaped pattern should be valid
          const validation = validateRegex(escaped);
          expect(validation.valid).toBe(true);
          
          // The escaped pattern should match the original literal string
          const regex = new RegExp(`^${escaped}$`);
          expect(regex.test(input)).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('escaping each special character individually should produce a pattern matching that character', () => {
    for (const char of specialChars) {
      const escaped = escapeSpecialChars(char);
      
      // Should be valid regex
      const validation = validateRegex(escaped);
      expect(validation.valid).toBe(true);
      
      // Should match the literal character
      const regex = new RegExp(`^${escaped}$`);
      expect(regex.test(char)).toBe(true);
    }
  });

  it('strings with multiple consecutive special characters should be properly escaped', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...specialChars), { minLength: 2, maxLength: 10 }).map(chars => chars.join('')),
        (input) => {
          const escaped = escapeSpecialChars(input);
          
          const validation = validateRegex(escaped);
          expect(validation.valid).toBe(true);
          
          const regex = new RegExp(`^${escaped}$`);
          expect(regex.test(input)).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mixed strings with special and normal characters should be properly escaped', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[A-Za-z0-9]{1,10}$/),
          fc.constantFrom(...specialChars),
          fc.stringMatching(/^[A-Za-z0-9]{1,10}$/)
        ).map(([prefix, special, suffix]) => prefix + special + suffix),
        (input) => {
          const escaped = escapeSpecialChars(input);
          
          const validation = validateRegex(escaped);
          expect(validation.valid).toBe(true);
          
          const regex = new RegExp(`^${escaped}$`);
          expect(regex.test(input)).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('escaping should be idempotent for already-safe strings (alphanumeric only)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9]{1,50}$/),
        (safeInput) => {
          const escaped = escapeSpecialChars(safeInput);
          
          // For strings without special chars, escaping should not change them
          expect(escaped).toBe(safeInput);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});



// **Feature: discount-code-extraction-workflow, Property 8: Regex Validation Accuracy**
// **Validates: Requirements 3.5, 3.6, 4.4**
describe('Property 8: Regex Validation Accuracy', () => {
  // Valid regex patterns that should pass validation
  const validPatterns = [
    '.*',
    '\\d+',
    '[a-z]+',
    '[A-Z0-9]{6,12}',
    '^test$',
    'hello|world',
    '(foo)(bar)',
    '(?:non-capturing)',
    '\\w+@\\w+\\.\\w+',
    '[^abc]',
    'a{2,5}',
    'a+?',
    'a*?',
  ];

  // Invalid regex patterns that should fail validation (verified to be invalid in JavaScript)
  const invalidPatterns = [
    '[',           // Unclosed bracket
    '(',           // Unclosed parenthesis
    '\\',          // Trailing backslash
    '[z-a]',       // Invalid range
  ];

  // Valid flags
  const validFlags = ['', 'g', 'i', 'gi', 'gim', 'gimsuy', 'm', 's', 'u', 'y'];

  // Invalid flags
  const invalidFlags = ['x', 'z', 'abc', 'gx', 'gg', 'ii'];

  it('for any valid regex pattern, validation should return valid: true', () => {
    for (const pattern of validPatterns) {
      const result = validateRegex(pattern);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    }
  });

  it('for any invalid regex pattern, validation should return valid: false with an error message', () => {
    for (const pattern of invalidPatterns) {
      const result = validateRegex(pattern);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe('string');
      expect(result.error!.length).toBeGreaterThan(0);
    }
  });

  it('for any valid flags, validation should accept them', () => {
    for (const flags of validFlags) {
      const result = validateRegex('test', flags);
      expect(result.valid).toBe(true);
    }
  });

  it('for any invalid flags, validation should reject them with clear error', () => {
    for (const flags of invalidFlags) {
      const result = validateRegex('test', flags);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('flag');
    }
  });

  it('empty pattern should be rejected with clear error message', () => {
    const emptyPatterns = ['', '   ', '\t', '\n'];
    
    for (const pattern of emptyPatterns) {
      const result = validateRegex(pattern);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('empty');
    }
  });

  it('for any randomly generated valid regex pattern, validation should correctly identify it as valid', () => {
    fc.assert(
      fc.property(
        // Generate patterns that are guaranteed to be valid
        fc.oneof(
          fc.stringMatching(/^[a-zA-Z0-9]+$/),  // Simple alphanumeric
          fc.stringMatching(/^[a-zA-Z]+\+$/),   // One or more
          fc.stringMatching(/^[a-zA-Z]+\*$/),   // Zero or more
          fc.stringMatching(/^[a-zA-Z]+\?$/),   // Optional
        ),
        (pattern) => {
          const result = validateRegex(pattern);
          
          // These patterns should be valid
          expect(result.valid).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validation result should be consistent - same input always produces same output', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9.*+?]{1,30}$/),
        fc.constantFrom('', 'g', 'gi', 'i'),
        (pattern, flags) => {
          const result1 = validateRegex(pattern, flags);
          const result2 = validateRegex(pattern, flags);
          
          expect(result1.valid).toBe(result2.valid);
          expect(result1.error).toBe(result2.error);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if validation returns valid: true, the pattern should be compilable as RegExp', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...validPatterns),
          fc.stringMatching(/^[a-zA-Z0-9]+$/)
        ),
        fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
        (pattern, flags) => {
          const result = validateRegex(pattern, flags);
          
          if (result.valid) {
            // Should not throw when creating RegExp
            expect(() => new RegExp(pattern, flags)).not.toThrow();
          }
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('if validation returns valid: false for known invalid patterns, the error message should be descriptive', () => {
    for (const pattern of invalidPatterns) {
      const result = validateRegex(pattern);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      // Error should contain meaningful information
      expect(result.error!.length).toBeGreaterThan(5);
    }
  });
});
