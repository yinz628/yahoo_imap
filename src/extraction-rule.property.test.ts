import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  PatternHistory,
  serializePattern,
  deserializePattern,
  validatePatternHistory,
  getPatterns,
  savePattern,
  deletePattern,
  ensureUserDir,
  getUserDir,
  ValidationError,
  StorageError,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');
const USERS_DIR = join(DATA_DIR, 'users');

// Cleanup helper
async function cleanupTestUser(userId: string): Promise<void> {
  try {
    await fs.rm(join(USERS_DIR, userId), { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
}

// Arbitraries for property testing
const MIN_TIMESTAMP = new Date('2020-01-01').getTime();
const MAX_TIMESTAMP = new Date('2030-01-01').getTime();

const isoDateArbitrary = fc.integer({ min: MIN_TIMESTAMP, max: MAX_TIMESTAMP })
  .map(ts => new Date(ts).toISOString());

const optionalIsoDateArbitrary = fc.oneof(
  fc.constant(undefined),
  isoDateArbitrary
);

// ExtractionRule arbitrary with all fields including patternName and tags
const extractionRuleArbitrary = fc.record({
  id: fc.uuid(),
  patternName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+', 'test', '\\w+', '[A-Z0-9]{6,20}'),
  regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm', 'gim'),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }), { nil: undefined }),
  createdAt: isoDateArbitrary,
  lastUsed: optionalIsoDateArbitrary,
});

// Pattern input arbitrary for savePattern
const patternInputArbitrary = fc.record({
  patternName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+', 'test', '\\w+', '[A-Z0-9]{6,20}'),
  regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
  tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }), { nil: undefined }),
});


describe('Discount Code Extraction Workflow - Property Tests', () => {
  // **Feature: discount-code-extraction-workflow, Property 1: Rule Data Serialization Round-Trip**
  // **Validates: Requirements 1.4, 1.5, 4.7, 4.8**
  describe('Property 1: Rule Data Serialization Round-Trip', () => {
    it('serializing and deserializing an ExtractionRule should produce an equivalent object with all fields preserved', () => {
      fc.assert(
        fc.property(extractionRuleArbitrary, (rule) => {
          const serialized = serializePattern(rule);
          const deserialized = deserializePattern(serialized);
          
          // All fields should be preserved
          expect(deserialized.id).toBe(rule.id);
          expect(deserialized.patternName).toBe(rule.patternName);
          expect(deserialized.subjectPattern).toBe(rule.subjectPattern);
          expect(deserialized.regexPattern).toBe(rule.regexPattern);
          expect(deserialized.regexFlags).toBe(rule.regexFlags);
          expect(deserialized.tags).toEqual(rule.tags);
          expect(deserialized.createdAt).toBe(rule.createdAt);
          expect(deserialized.lastUsed).toBe(rule.lastUsed);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('JSON.parse(JSON.stringify(rule)) should preserve all fields including patternName and tags', () => {
      fc.assert(
        fc.property(extractionRuleArbitrary, (rule) => {
          const roundTripped = JSON.parse(JSON.stringify(rule));
          
          expect(roundTripped).toEqual(rule);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('deserializePattern should throw ValidationError for invalid JSON', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => {
            try {
              JSON.parse(s);
              return false; // Valid JSON, skip
            } catch {
              return true; // Invalid JSON, keep
            }
          }),
          (invalidJson) => {
            expect(() => deserializePattern(invalidJson)).toThrow(ValidationError);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('deserializePattern should throw ValidationError for valid JSON with invalid structure', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.record({ foo: fc.string() }),
            fc.record({ id: fc.integer() }), // Wrong type for id
            fc.array(fc.anything())
          ),
          (invalidStructure) => {
            const json = JSON.stringify(invalidStructure);
            expect(() => deserializePattern(json)).toThrow(ValidationError);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });


  // **Feature: discount-code-extraction-workflow, Property 2: Rule List Completeness**
  // **Validates: Requirements 1.1, 1.2**
  describe('Property 2: Rule List Completeness', () => {
    it('for any set of saved rules, the list operation should return all rules with patternName, subjectPattern, and tags fields present', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternInputArbitrary, { minLength: 1, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'rule-list-completeness-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns: PatternHistory[] = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push(saved);
              }
              
              // Get all patterns
              const patterns = await getPatterns(testUserId);
              
              // Should have all saved patterns
              expect(patterns.length).toBe(patternInputs.length);
              
              // Each pattern should have all required fields present
              for (const pattern of patterns) {
                // Required fields must be present
                expect(typeof pattern.id).toBe('string');
                expect(pattern.id.length).toBeGreaterThan(0);
                expect(typeof pattern.subjectPattern).toBe('string');
                expect(typeof pattern.regexPattern).toBe('string');
                expect(typeof pattern.regexFlags).toBe('string');
                expect(typeof pattern.createdAt).toBe('string');
                
                // Optional fields should be correct type if present
                if (pattern.patternName !== undefined) {
                  expect(typeof pattern.patternName).toBe('string');
                }
                if (pattern.tags !== undefined) {
                  expect(Array.isArray(pattern.tags)).toBe(true);
                }
              }
              
              // All saved IDs should be present
              for (const saved of savedPatterns) {
                const found = patterns.find(p => p.id === saved.id);
                expect(found).toBeDefined();
                expect(found?.patternName).toBe(saved.patternName);
                expect(found?.subjectPattern).toBe(saved.subjectPattern);
                expect(found?.tags).toEqual(saved.tags);
              }
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });


  // **Feature: discount-code-extraction-workflow, Property 3: Rule Deletion Consistency**
  // **Validates: Requirements 1.3**
  describe('Property 3: Rule Deletion Consistency', () => {
    it('for any rule that is deleted, subsequent list operations should not include that rule', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternInputArbitrary, { minLength: 2, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'rule-deletion-consistency-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns: PatternHistory[] = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push(saved);
              }
              
              // Verify all patterns exist
              let patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(patternInputs.length);
              
              // Delete the first pattern
              const deletedPattern = savedPatterns[0];
              await deletePattern(testUserId, deletedPattern.id);
              
              // Get patterns again
              patterns = await getPatterns(testUserId);
              
              // Deleted pattern should not be in the list
              expect(patterns.length).toBe(patternInputs.length - 1);
              expect(patterns.some(p => p.id === deletedPattern.id)).toBe(false);
              
              // Other patterns should still be present
              for (let i = 1; i < savedPatterns.length; i++) {
                expect(patterns.some(p => p.id === savedPatterns[i].id)).toBe(true);
              }
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('deleting all rules one by one should result in empty list', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternInputArbitrary, { minLength: 1, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'rule-delete-all-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns: PatternHistory[] = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push(saved);
              }
              
              // Delete all patterns one by one
              for (const pattern of savedPatterns) {
                await deletePattern(testUserId, pattern.id);
              }
              
              // List should be empty
              const patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(0);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('deleting non-existent rule should throw StorageError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (nonExistentId) => {
            const testUserId = 'rule-delete-nonexistent-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              await ensureUserDir(testUserId);
              await expect(deletePattern(testUserId, nonExistentId)).rejects.toThrow(StorageError);
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
