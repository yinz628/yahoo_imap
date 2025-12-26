import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  Mailbox,
  PatternHistory,
  serializeMailbox,
  deserializeMailbox,
  serializePattern,
  deserializePattern,
  validateMailbox,
  validatePatternHistory,
  encryptPassword,
  decryptPassword,
  getMailboxes,
  saveMailbox,
  deleteMailbox,
  getPatterns,
  savePattern,
  deletePattern,
  updatePatternLastUsed,
  ensureUserDir,
  getUserDir,
  ValidationError,
  StorageError,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');
const USERS_DIR = join(DATA_DIR, 'users');

// Test user IDs for isolation testing
const TEST_USER_1 = 'test-user-1-' + Date.now();
const TEST_USER_2 = 'test-user-2-' + Date.now();

// Cleanup helper
async function cleanupTestUser(userId: string): Promise<void> {
  try {
    await fs.rm(join(USERS_DIR, userId), { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
}

// Arbitraries for property testing
// Use integer timestamps to avoid invalid date issues
const MIN_TIMESTAMP = new Date('2020-01-01').getTime();
const MAX_TIMESTAMP = new Date('2030-01-01').getTime();

const isoDateArbitrary = fc.integer({ min: MIN_TIMESTAMP, max: MAX_TIMESTAMP })
  .map(ts => new Date(ts).toISOString());

const optionalIsoDateArbitrary = fc.oneof(
  fc.constant(undefined),
  isoDateArbitrary
);

const mailboxArbitrary = fc.record({
  id: fc.uuid(),
  email: fc.emailAddress(),
  encryptedPassword: fc.string({ minLength: 20, maxLength: 100 }),
  provider: fc.constantFrom('yahoo', 'gmail', 'custom') as fc.Arbitrary<'yahoo' | 'gmail' | 'custom'>,
  addedAt: isoDateArbitrary,
  lastUsed: optionalIsoDateArbitrary,
});

const patternArbitrary = fc.record({
  id: fc.uuid(),
  subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm', 'gim'),
  createdAt: isoDateArbitrary,
  lastUsed: optionalIsoDateArbitrary,
});


describe('Storage Property Tests', () => {
  // **Feature: web-ui-upgrade, Property 1: Data Serialization Round-Trip**
  // **Validates: Requirements 1.7, 2.5, 4.7, 5.7**
  describe('Property 1: Data Serialization Round-Trip', () => {
    it('serializing and deserializing a Mailbox should produce an equivalent object', () => {
      fc.assert(
        fc.property(mailboxArbitrary, (mailbox) => {
          const serialized = serializeMailbox(mailbox);
          const deserialized = deserializeMailbox(serialized);
          
          expect(deserialized.id).toBe(mailbox.id);
          expect(deserialized.email).toBe(mailbox.email);
          expect(deserialized.encryptedPassword).toBe(mailbox.encryptedPassword);
          expect(deserialized.provider).toBe(mailbox.provider);
          expect(deserialized.addedAt).toBe(mailbox.addedAt);
          expect(deserialized.lastUsed).toBe(mailbox.lastUsed);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('serializing and deserializing a PatternHistory should produce an equivalent object', () => {
      fc.assert(
        fc.property(patternArbitrary, (pattern) => {
          const serialized = serializePattern(pattern);
          const deserialized = deserializePattern(serialized);
          
          expect(deserialized.id).toBe(pattern.id);
          expect(deserialized.subjectPattern).toBe(pattern.subjectPattern);
          expect(deserialized.regexPattern).toBe(pattern.regexPattern);
          expect(deserialized.regexFlags).toBe(pattern.regexFlags);
          expect(deserialized.createdAt).toBe(pattern.createdAt);
          expect(deserialized.lastUsed).toBe(pattern.lastUsed);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('JSON.parse(JSON.stringify(mailbox)) should preserve all fields', () => {
      fc.assert(
        fc.property(mailboxArbitrary, (mailbox) => {
          const roundTripped = JSON.parse(JSON.stringify(mailbox));
          
          expect(roundTripped).toEqual(mailbox);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });

    it('JSON.parse(JSON.stringify(pattern)) should preserve all fields', () => {
      fc.assert(
        fc.property(patternArbitrary, (pattern) => {
          const roundTripped = JSON.parse(JSON.stringify(pattern));
          
          expect(roundTripped).toEqual(pattern);
          
          return true;
        }),
        { numRuns: 100 }
      );
    });
  });
});


describe('Storage Property Tests - User Data Isolation', () => {
  // **Feature: web-ui-upgrade, Property 8: User Data Isolation**
  // **Validates: Requirements 2.3**
  describe('Property 8: User Data Isolation', () => {
    afterEach(async () => {
      // Cleanup test users after each test
      await cleanupTestUser(TEST_USER_1);
      await cleanupTestUser(TEST_USER_2);
    });

    it('different users should have separate data directories', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.uuid(),
          async (userId1, userId2) => {
            // Ensure different user IDs
            if (userId1 === userId2) return true;
            
            const dir1 = getUserDir(userId1);
            const dir2 = getUserDir(userId2);
            
            // Directories should be different
            expect(dir1).not.toBe(dir2);
            
            // Each directory should contain the user ID
            expect(dir1).toContain(userId1);
            expect(dir2).toContain(userId2);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('saving data for one user should not affect another user', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 20 }),
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 20 }),
          async (email1, password1, email2, password2) => {
            // Use fixed test user IDs for this test
            const testUser1 = 'isolation-test-user-1-' + Date.now();
            const testUser2 = 'isolation-test-user-2-' + Date.now();
            
            try {
              // Save mailbox for user 1
              await saveMailbox(testUser1, { email: email1, password: password1 });
              
              // Save mailbox for user 2
              await saveMailbox(testUser2, { email: email2, password: password2 });
              
              // Get mailboxes for each user
              const mailboxes1 = await getMailboxes(testUser1);
              const mailboxes2 = await getMailboxes(testUser2);
              
              // Each user should only see their own mailbox
              expect(mailboxes1.length).toBe(1);
              expect(mailboxes2.length).toBe(1);
              expect(mailboxes1[0].email).toBe(email1);
              expect(mailboxes2[0].email).toBe(email2);
              
              // User 1's mailbox should not appear in user 2's list
              expect(mailboxes2.some(m => m.email === email1)).toBe(false);
              // User 2's mailbox should not appear in user 1's list
              expect(mailboxes1.some(m => m.email === email2)).toBe(false);
              
              return true;
            } finally {
              // Cleanup
              await cleanupTestUser(testUser1);
              await cleanupTestUser(testUser2);
            }
          }
        ),
        { numRuns: 10 } // Reduced runs due to file I/O
      );
    });

    it('deleting data for one user should not affect another user', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 20 }),
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 20 }),
          async (email1, password1, email2, password2) => {
            const testUser1 = 'delete-test-user-1-' + Date.now();
            const testUser2 = 'delete-test-user-2-' + Date.now();
            
            try {
              // Save mailbox for both users
              const mailbox1 = await saveMailbox(testUser1, { email: email1, password: password1 });
              await saveMailbox(testUser2, { email: email2, password: password2 });
              
              // Delete user 1's mailbox
              await deleteMailbox(testUser1, mailbox1.id);
              
              // User 1 should have no mailboxes
              const mailboxes1 = await getMailboxes(testUser1);
              expect(mailboxes1.length).toBe(0);
              
              // User 2 should still have their mailbox
              const mailboxes2 = await getMailboxes(testUser2);
              expect(mailboxes2.length).toBe(1);
              expect(mailboxes2[0].email).toBe(email2);
              
              return true;
            } finally {
              await cleanupTestUser(testUser1);
              await cleanupTestUser(testUser2);
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});


describe('Storage Property Tests - Validation', () => {
  // **Feature: web-ui-upgrade, Property 9: Invalid Data Structure Rejection**
  // **Validates: Requirements 2.4, 4.6, 5.6**
  describe('Property 9: Invalid Data Structure Rejection', () => {
    it('validateMailbox should reject objects missing required fields', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Missing id
            fc.record({
              email: fc.emailAddress(),
              encryptedPassword: fc.string({ minLength: 20 }),
              addedAt: isoDateArbitrary,
            }),
            // Missing email
            fc.record({
              id: fc.uuid(),
              encryptedPassword: fc.string({ minLength: 20 }),
              addedAt: isoDateArbitrary,
            }),
            // Missing encryptedPassword
            fc.record({
              id: fc.uuid(),
              email: fc.emailAddress(),
              addedAt: isoDateArbitrary,
            }),
            // Missing addedAt
            fc.record({
              id: fc.uuid(),
              email: fc.emailAddress(),
              encryptedPassword: fc.string({ minLength: 20 }),
            }),
            // Empty id
            fc.record({
              id: fc.constant(''),
              email: fc.emailAddress(),
              encryptedPassword: fc.string({ minLength: 20 }),
              addedAt: isoDateArbitrary,
            }),
            // Empty email
            fc.record({
              id: fc.uuid(),
              email: fc.constant(''),
              encryptedPassword: fc.string({ minLength: 20 }),
              addedAt: isoDateArbitrary,
            })
          ),
          (invalidMailbox) => {
            expect(validateMailbox(invalidMailbox)).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validatePatternHistory should reject objects missing required fields', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Missing id
            fc.record({
              subjectPattern: fc.string({ minLength: 1 }),
              regexPattern: fc.string({ minLength: 1 }),
              regexFlags: fc.constantFrom('', 'g', 'gi'),
              createdAt: isoDateArbitrary,
            }),
            // Missing subjectPattern
            fc.record({
              id: fc.uuid(),
              regexPattern: fc.string({ minLength: 1 }),
              regexFlags: fc.constantFrom('', 'g', 'gi'),
              createdAt: isoDateArbitrary,
            }),
            // Missing regexPattern
            fc.record({
              id: fc.uuid(),
              subjectPattern: fc.string({ minLength: 1 }),
              regexFlags: fc.constantFrom('', 'g', 'gi'),
              createdAt: isoDateArbitrary,
            }),
            // Missing regexFlags
            fc.record({
              id: fc.uuid(),
              subjectPattern: fc.string({ minLength: 1 }),
              regexPattern: fc.string({ minLength: 1 }),
              createdAt: isoDateArbitrary,
            }),
            // Missing createdAt
            fc.record({
              id: fc.uuid(),
              subjectPattern: fc.string({ minLength: 1 }),
              regexPattern: fc.string({ minLength: 1 }),
              regexFlags: fc.constantFrom('', 'g', 'gi'),
            }),
            // Empty id
            fc.record({
              id: fc.constant(''),
              subjectPattern: fc.string({ minLength: 1 }),
              regexPattern: fc.string({ minLength: 1 }),
              regexFlags: fc.constantFrom('', 'g', 'gi'),
              createdAt: isoDateArbitrary,
            })
          ),
          (invalidPattern) => {
            expect(validatePatternHistory(invalidPattern)).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validateMailbox should reject non-object values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.anything())
          ),
          (invalidValue) => {
            expect(validateMailbox(invalidValue)).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('validatePatternHistory should reject non-object values', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.anything())
          ),
          (invalidValue) => {
            expect(validatePatternHistory(invalidValue)).toBe(false);
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('deserializeMailbox should throw ValidationError for invalid JSON', () => {
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
            expect(() => deserializeMailbox(invalidJson)).toThrow(ValidationError);
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('deserializePattern should throw ValidationError for invalid JSON', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => {
            try {
              JSON.parse(s);
              return false;
            } catch {
              return true;
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

    it('deserializeMailbox should throw ValidationError for valid JSON with invalid structure', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.record({ foo: fc.string() }),
            fc.record({ id: fc.integer() }), // Wrong type for id
            fc.array(fc.anything())
          ),
          (invalidStructure) => {
            const json = JSON.stringify(invalidStructure);
            expect(() => deserializeMailbox(json)).toThrow(ValidationError);
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
            fc.record({ id: fc.integer() }),
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
});


describe('Storage Property Tests - Mailbox Password Encryption', () => {
  // **Feature: web-ui-upgrade, Property 3: Mailbox Password Encryption**
  // **Validates: Requirements 4.5**
  describe('Property 3: Mailbox Password Encryption', () => {
    it('encrypted password should never equal the original plaintext password', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (password) => {
            const encrypted = encryptPassword(password);
            
            // Encrypted password should never equal plaintext
            expect(encrypted).not.toBe(password);
            
            // Encrypted password should contain the IV separator
            expect(encrypted).toContain(':');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('encrypted password should be decryptable back to the original', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (password) => {
            const encrypted = encryptPassword(password);
            const decrypted = decryptPassword(encrypted);
            
            // Decrypted password should equal original
            expect(decrypted).toBe(password);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('encrypting the same password twice should produce different ciphertexts (due to random IV)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }),
          (password) => {
            const encrypted1 = encryptPassword(password);
            const encrypted2 = encryptPassword(password);
            
            // Due to random IV, same password should produce different ciphertexts
            expect(encrypted1).not.toBe(encrypted2);
            
            // But both should decrypt to the same original password
            expect(decryptPassword(encrypted1)).toBe(password);
            expect(decryptPassword(encrypted2)).toBe(password);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('saved mailbox should have encrypted password that differs from input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 50 }),
          async (email, password) => {
            const testUserId = 'encryption-test-user-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save mailbox with plaintext password
              const savedMailbox = await saveMailbox(testUserId, { email, password });
              
              // Encrypted password should not equal plaintext
              expect(savedMailbox.encryptedPassword).not.toBe(password);
              
              // Encrypted password should be decryptable to original
              const decrypted = decryptPassword(savedMailbox.encryptedPassword);
              expect(decrypted).toBe(password);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 } // Reduced runs due to file I/O
      );
    });
  });
});


describe('Storage Property Tests - Mailbox CRUD Consistency', () => {
  // **Feature: web-ui-upgrade, Property 10: Mailbox CRUD Consistency**
  // **Validates: Requirements 4.1, 4.2, 4.4**
  describe('Property 10: Mailbox CRUD Consistency', () => {
    it('after adding a mailbox, getMailboxes should return it', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 50 }),
          async (email, password) => {
            const testUserId = 'crud-add-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Initially should have no mailboxes
              const initialMailboxes = await getMailboxes(testUserId);
              expect(initialMailboxes.length).toBe(0);
              
              // Add a mailbox
              const savedMailbox = await saveMailbox(testUserId, { email, password });
              
              // Should now have one mailbox
              const mailboxes = await getMailboxes(testUserId);
              expect(mailboxes.length).toBe(1);
              expect(mailboxes[0].id).toBe(savedMailbox.id);
              expect(mailboxes[0].email).toBe(email);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('after deleting a mailbox, getMailboxes should not return it', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 50 }),
          async (email, password) => {
            const testUserId = 'crud-delete-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Add a mailbox
              const savedMailbox = await saveMailbox(testUserId, { email, password });
              
              // Verify it exists
              let mailboxes = await getMailboxes(testUserId);
              expect(mailboxes.length).toBe(1);
              
              // Delete the mailbox
              await deleteMailbox(testUserId, savedMailbox.id);
              
              // Should now have no mailboxes
              mailboxes = await getMailboxes(testUserId);
              expect(mailboxes.length).toBe(0);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('multiple add operations should accumulate mailboxes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              email: fc.emailAddress(),
              password: fc.string({ minLength: 8, maxLength: 50 }),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (mailboxInputs) => {
            const testUserId = 'crud-multi-add-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Add all mailboxes
              const savedMailboxes = [];
              for (const input of mailboxInputs) {
                const saved = await saveMailbox(testUserId, input);
                savedMailboxes.push(saved);
              }
              
              // Get all mailboxes
              const mailboxes = await getMailboxes(testUserId);
              
              // Should have all added mailboxes
              expect(mailboxes.length).toBe(mailboxInputs.length);
              
              // All saved IDs should be present
              for (const saved of savedMailboxes) {
                expect(mailboxes.some(m => m.id === saved.id)).toBe(true);
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

    it('deleting one mailbox should not affect others', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 50 }),
          fc.emailAddress(),
          fc.string({ minLength: 8, maxLength: 50 }),
          async (email1, password1, email2, password2) => {
            const testUserId = 'crud-partial-delete-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Add two mailboxes
              const mailbox1 = await saveMailbox(testUserId, { email: email1, password: password1 });
              const mailbox2 = await saveMailbox(testUserId, { email: email2, password: password2 });
              
              // Verify both exist
              let mailboxes = await getMailboxes(testUserId);
              expect(mailboxes.length).toBe(2);
              
              // Delete first mailbox
              await deleteMailbox(testUserId, mailbox1.id);
              
              // Should have only second mailbox
              mailboxes = await getMailboxes(testUserId);
              expect(mailboxes.length).toBe(1);
              expect(mailboxes[0].id).toBe(mailbox2.id);
              expect(mailboxes[0].email).toBe(email2);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('deleting non-existent mailbox should throw StorageError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (nonExistentId) => {
            const testUserId = 'crud-delete-nonexistent-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Ensure user directory exists
              await ensureUserDir(testUserId);
              
              // Attempting to delete non-existent mailbox should throw
              await expect(deleteMailbox(testUserId, nonExistentId)).rejects.toThrow(StorageError);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('sequence of add and delete operations should maintain consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              email: fc.emailAddress(),
              password: fc.string({ minLength: 8, maxLength: 50 }),
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (mailboxInputs) => {
            const testUserId = 'crud-sequence-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Add all mailboxes
              const savedMailboxes = [];
              for (const input of mailboxInputs) {
                const saved = await saveMailbox(testUserId, input);
                savedMailboxes.push(saved);
              }
              
              // Delete every other mailbox
              const deletedIds = new Set<string>();
              for (let i = 0; i < savedMailboxes.length; i += 2) {
                await deleteMailbox(testUserId, savedMailboxes[i].id);
                deletedIds.add(savedMailboxes[i].id);
              }
              
              // Get remaining mailboxes
              const remainingMailboxes = await getMailboxes(testUserId);
              
              // Count should match expected
              const expectedCount = savedMailboxes.length - deletedIds.size;
              expect(remainingMailboxes.length).toBe(expectedCount);
              
              // Deleted mailboxes should not be present
              for (const mailbox of remainingMailboxes) {
                expect(deletedIds.has(mailbox.id)).toBe(false);
              }
              
              // Non-deleted mailboxes should be present
              for (const saved of savedMailboxes) {
                if (!deletedIds.has(saved.id)) {
                  expect(remainingMailboxes.some(m => m.id === saved.id)).toBe(true);
                }
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
});


describe('Storage Property Tests - Pattern History CRUD Consistency', () => {
  // **Feature: web-ui-upgrade, Property 11: Pattern History CRUD Consistency**
  // **Validates: Requirements 5.2, 5.3, 5.5**
  describe('Property 11: Pattern History CRUD Consistency', () => {
    // Arbitrary for valid pattern input (not the full PatternHistory, but the input to savePattern)
    const patternInputArbitrary = fc.record({
      subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
      regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+', 'test', '\\w+'),  // Use valid regex patterns
      regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
    });

    it('after saving a pattern, getPatterns should return it', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'pattern-crud-add-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Initially should have no patterns
              const initialPatterns = await getPatterns(testUserId);
              expect(initialPatterns.length).toBe(0);
              
              // Save a pattern
              const savedPattern = await savePattern(testUserId, patternInput);
              
              // Should now have one pattern
              const patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(1);
              expect(patterns[0].id).toBe(savedPattern.id);
              expect(patterns[0].subjectPattern).toBe(patternInput.subjectPattern);
              expect(patterns[0].regexPattern).toBe(patternInput.regexPattern);
              expect(patterns[0].regexFlags).toBe(patternInput.regexFlags);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('after deleting a pattern, getPatterns should not return it', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'pattern-crud-delete-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save a pattern
              const savedPattern = await savePattern(testUserId, patternInput);
              
              // Verify it exists
              let patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(1);
              
              // Delete the pattern
              await deletePattern(testUserId, savedPattern.id);
              
              // Should now have no patterns
              patterns = await getPatterns(testUserId);
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

    it('multiple save operations should accumulate patterns', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternInputArbitrary, { minLength: 1, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'pattern-crud-multi-add-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push(saved);
              }
              
              // Get all patterns
              const patterns = await getPatterns(testUserId);
              
              // Should have all saved patterns
              expect(patterns.length).toBe(patternInputs.length);
              
              // All saved IDs should be present
              for (const saved of savedPatterns) {
                expect(patterns.some(p => p.id === saved.id)).toBe(true);
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

    it('deleting one pattern should not affect others', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          patternInputArbitrary,
          async (patternInput1, patternInput2) => {
            const testUserId = 'pattern-crud-partial-delete-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save two patterns
              const pattern1 = await savePattern(testUserId, patternInput1);
              const pattern2 = await savePattern(testUserId, patternInput2);
              
              // Verify both exist
              let patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(2);
              
              // Delete first pattern
              await deletePattern(testUserId, pattern1.id);
              
              // Should have only second pattern
              patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(1);
              expect(patterns[0].id).toBe(pattern2.id);
              expect(patterns[0].subjectPattern).toBe(patternInput2.subjectPattern);
              
              return true;
            } finally {
              await cleanupTestUser(testUserId);
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('deleting non-existent pattern should throw StorageError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (nonExistentId) => {
            const testUserId = 'pattern-crud-delete-nonexistent-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Ensure user directory exists
              await ensureUserDir(testUserId);
              
              // Attempting to delete non-existent pattern should throw
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

    it('sequence of save and delete operations should maintain consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(patternInputArbitrary, { minLength: 2, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'pattern-crud-sequence-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push(saved);
              }
              
              // Delete every other pattern
              const deletedIds = new Set<string>();
              for (let i = 0; i < savedPatterns.length; i += 2) {
                await deletePattern(testUserId, savedPatterns[i].id);
                deletedIds.add(savedPatterns[i].id);
              }
              
              // Get remaining patterns
              const remainingPatterns = await getPatterns(testUserId);
              
              // Count should match expected
              const expectedCount = savedPatterns.length - deletedIds.size;
              expect(remainingPatterns.length).toBe(expectedCount);
              
              // Deleted patterns should not be present
              for (const pattern of remainingPatterns) {
                expect(deletedIds.has(pattern.id)).toBe(false);
              }
              
              // Non-deleted patterns should be present
              for (const saved of savedPatterns) {
                if (!deletedIds.has(saved.id)) {
                  expect(remainingPatterns.some(p => p.id === saved.id)).toBe(true);
                }
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

    it('list operation should reflect current state after all operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              operation: fc.constantFrom('save', 'delete'),
              patternInput: patternInputArbitrary,
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (operations) => {
            const testUserId = 'pattern-crud-state-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Track expected state
              const expectedPatterns = new Map<string, { subjectPattern: string; regexPattern: string; regexFlags: string }>();
              const savedIds: string[] = [];
              
              for (const op of operations) {
                if (op.operation === 'save') {
                  const saved = await savePattern(testUserId, op.patternInput);
                  expectedPatterns.set(saved.id, {
                    subjectPattern: op.patternInput.subjectPattern,
                    regexPattern: op.patternInput.regexPattern,
                    regexFlags: op.patternInput.regexFlags,
                  });
                  savedIds.push(saved.id);
                } else if (op.operation === 'delete' && savedIds.length > 0) {
                  // Delete a random existing pattern
                  const idToDelete = savedIds[Math.floor(Math.random() * savedIds.length)];
                  if (expectedPatterns.has(idToDelete)) {
                    await deletePattern(testUserId, idToDelete);
                    expectedPatterns.delete(idToDelete);
                  }
                }
              }
              
              // Verify final state
              const patterns = await getPatterns(testUserId);
              expect(patterns.length).toBe(expectedPatterns.size);
              
              for (const pattern of patterns) {
                expect(expectedPatterns.has(pattern.id)).toBe(true);
                const expected = expectedPatterns.get(pattern.id)!;
                expect(pattern.subjectPattern).toBe(expected.subjectPattern);
                expect(pattern.regexPattern).toBe(expected.regexPattern);
                expect(pattern.regexFlags).toBe(expected.regexFlags);
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
});


describe('Storage Property Tests - Last Used Timestamp Update', () => {
  // **Feature: discount-code-extraction-workflow, Property 13: Last Used Timestamp Update**
  // **Validates: Requirements 5.4**
  describe('Property 13: Last Used Timestamp Update', () => {
    // Arbitrary for valid pattern input
    const patternInputArbitrary = fc.record({
      subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
      regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+', 'test', '\\w+'),
      regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
    });

    it('updating lastUsed should set timestamp to a time after the previous value', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'lastused-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save a pattern (initially has no lastUsed)
              const savedPattern = await savePattern(testUserId, patternInput);
              
              // Get the pattern to check initial state
              let patterns = await getPatterns(testUserId);
              const initialPattern = patterns.find(p => p.id === savedPattern.id);
              expect(initialPattern).toBeDefined();
              const initialLastUsed = initialPattern!.lastUsed;
              
              // Wait a small amount to ensure timestamp difference
              await new Promise(resolve => setTimeout(resolve, 10));
              
              // Update lastUsed
              const updatedPattern = await updatePatternLastUsed(testUserId, savedPattern.id);
              
              // Verify lastUsed is set
              expect(updatedPattern.lastUsed).toBeDefined();
              
              // If there was a previous lastUsed, the new one should be after it
              if (initialLastUsed) {
                const initialTime = new Date(initialLastUsed).getTime();
                const updatedTime = new Date(updatedPattern.lastUsed!).getTime();
                expect(updatedTime).toBeGreaterThan(initialTime);
              }
              
              // Verify the change is persisted
              patterns = await getPatterns(testUserId);
              const persistedPattern = patterns.find(p => p.id === savedPattern.id);
              expect(persistedPattern).toBeDefined();
              expect(persistedPattern!.lastUsed).toBe(updatedPattern.lastUsed);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('multiple lastUsed updates should produce increasing timestamps', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          fc.integer({ min: 2, max: 5 }),
          async (patternInput, updateCount) => {
            const testUserId = 'lastused-multi-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save a pattern
              const savedPattern = await savePattern(testUserId, patternInput);
              
              const timestamps: number[] = [];
              
              // Perform multiple updates
              for (let i = 0; i < updateCount; i++) {
                // Wait a small amount to ensure timestamp difference
                await new Promise(resolve => setTimeout(resolve, 10));
                
                const updatedPattern = await updatePatternLastUsed(testUserId, savedPattern.id);
                expect(updatedPattern.lastUsed).toBeDefined();
                timestamps.push(new Date(updatedPattern.lastUsed!).getTime());
              }
              
              // Verify timestamps are strictly increasing
              for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
              }
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 5 }
      );
    });

    it('updating lastUsed for non-existent pattern should throw StorageError', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (nonExistentId) => {
            const testUserId = 'lastused-nonexistent-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Ensure user directory exists
              await ensureUserDir(testUserId);
              
              // Attempting to update lastUsed for non-existent pattern should throw
              await expect(updatePatternLastUsed(testUserId, nonExistentId)).rejects.toThrow(StorageError);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('updating lastUsed should not affect other pattern fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          patternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'lastused-fields-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save a pattern
              const savedPattern = await savePattern(testUserId, patternInput);
              
              // Get the pattern before update
              let patterns = await getPatterns(testUserId);
              const beforeUpdate = patterns.find(p => p.id === savedPattern.id)!;
              
              // Wait and update lastUsed
              await new Promise(resolve => setTimeout(resolve, 10));
              await updatePatternLastUsed(testUserId, savedPattern.id);
              
              // Get the pattern after update
              patterns = await getPatterns(testUserId);
              const afterUpdate = patterns.find(p => p.id === savedPattern.id)!;
              
              // Verify other fields are unchanged
              expect(afterUpdate.id).toBe(beforeUpdate.id);
              expect(afterUpdate.subjectPattern).toBe(beforeUpdate.subjectPattern);
              expect(afterUpdate.regexPattern).toBe(beforeUpdate.regexPattern);
              expect(afterUpdate.regexFlags).toBe(beforeUpdate.regexFlags);
              expect(afterUpdate.createdAt).toBe(beforeUpdate.createdAt);
              
              // Only lastUsed should have changed
              expect(afterUpdate.lastUsed).not.toBe(beforeUpdate.lastUsed);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});


describe('Storage Property Tests - Rule Save and Retrieve Consistency', () => {
  // **Feature: discount-code-extraction-workflow, Property 11: Rule Save and Retrieve Consistency**
  // **Validates: Requirements 4.6**
  describe('Property 11: Rule Save and Retrieve Consistency', () => {
    // Arbitrary for valid pattern input with extended fields (patternName, tags)
    // Note: patternName and tags are trimmed by storage layer, so we generate non-whitespace strings
    const extendedPatternInputArbitrary = fc.record({
      patternName: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0), { nil: undefined }),
      subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
      regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+', 'test', '\\w+', '[A-Z0-9]{8}'),
      regexFlags: fc.constantFrom('', 'g', 'gi', 'i', 'gm'),
      tags: fc.option(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0), { maxLength: 5 }),
        { nil: undefined }
      ),
    });

    it('saved rule should be retrievable with all fields intact', async () => {
      await fc.assert(
        fc.asyncProperty(
          extendedPatternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'rule-retrieve-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save a pattern with extended fields
              const savedPattern = await savePattern(testUserId, patternInput);
              
              // Retrieve all patterns
              const patterns = await getPatterns(testUserId);
              
              // Find the saved pattern
              const retrievedPattern = patterns.find(p => p.id === savedPattern.id);
              expect(retrievedPattern).toBeDefined();
              
              // Verify all fields match (accounting for trimming)
              const expectedPatternName = patternInput.patternName?.trim() || undefined;
              const expectedTags = patternInput.tags?.map(t => t.trim()).filter(t => t.length > 0) || undefined;
              
              expect(retrievedPattern!.patternName).toBe(expectedPatternName);
              expect(retrievedPattern!.subjectPattern).toBe(patternInput.subjectPattern);
              expect(retrievedPattern!.regexPattern).toBe(patternInput.regexPattern);
              expect(retrievedPattern!.regexFlags).toBe(patternInput.regexFlags);
              expect(retrievedPattern!.tags).toEqual(expectedTags);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('multiple saved rules should each be retrievable with correct fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(extendedPatternInputArbitrary, { minLength: 2, maxLength: 5 }),
          async (patternInputs) => {
            const testUserId = 'rule-multi-retrieve-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save all patterns
              const savedPatterns = [];
              for (const input of patternInputs) {
                const saved = await savePattern(testUserId, input);
                savedPatterns.push({ input, saved });
              }
              
              // Retrieve all patterns
              const patterns = await getPatterns(testUserId);
              
              // Verify each saved pattern is retrievable with correct fields
              for (const { input, saved } of savedPatterns) {
                const retrieved = patterns.find(p => p.id === saved.id);
                expect(retrieved).toBeDefined();
                
                // Account for trimming
                const expectedPatternName = input.patternName?.trim() || undefined;
                const expectedTags = input.tags?.map(t => t.trim()).filter(t => t.length > 0) || undefined;
                
                expect(retrieved!.patternName).toBe(expectedPatternName);
                expect(retrieved!.subjectPattern).toBe(input.subjectPattern);
                expect(retrieved!.regexPattern).toBe(input.regexPattern);
                expect(retrieved!.regexFlags).toBe(input.regexFlags);
                expect(retrieved!.tags).toEqual(expectedTags);
              }
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('retrieved rule should preserve patternName and tags through save/retrieve cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          extendedPatternInputArbitrary,
          async (patternInput) => {
            const testUserId = 'rule-roundtrip-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save pattern
              const saved1 = await savePattern(testUserId, patternInput);
              
              // Retrieve it
              let patterns = await getPatterns(testUserId);
              const retrieved1 = patterns.find(p => p.id === saved1.id)!;
              
              // Account for trimming
              const expectedPatternName = patternInput.patternName?.trim() || undefined;
              const expectedTags = patternInput.tags?.map(t => t.trim()).filter(t => t.length > 0) || undefined;
              
              // Verify fields match
              expect(retrieved1.patternName).toBe(expectedPatternName);
              expect(retrieved1.tags).toEqual(expectedTags);
              
              // Retrieve again to ensure persistence
              patterns = await getPatterns(testUserId);
              const retrieved2 = patterns.find(p => p.id === saved1.id)!;
              
              // Verify fields still match
              expect(retrieved2.patternName).toBe(retrieved1.patternName);
              expect(retrieved2.tags).toEqual(retrieved1.tags);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });

    it('empty tags array should be preserved on retrieve', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            patternName: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0), { nil: undefined }),
            subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
            regexPattern: fc.constantFrom('.*', '\\d+', '[a-z]+'),
            regexFlags: fc.constantFrom('', 'g', 'gi'),
            tags: fc.constant([] as string[]),
          }),
          async (patternInput) => {
            const testUserId = 'rule-empty-tags-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            
            try {
              // Save pattern with empty tags
              const saved = await savePattern(testUserId, patternInput);
              
              // Retrieve it
              const patterns = await getPatterns(testUserId);
              const retrieved = patterns.find(p => p.id === saved.id)!;
              
              // Empty tags should be preserved (or undefined, depending on implementation)
              expect(retrieved.tags === undefined || retrieved.tags.length === 0).toBe(true);
              
              return true;
            } finally {
              // Cleanup
              try {
                await fs.rm(join(USERS_DIR, testUserId), { recursive: true, force: true });
              } catch {
                // Directory may not exist
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
