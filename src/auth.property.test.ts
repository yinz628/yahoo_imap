import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hashPassword, isValidBcryptHash } from './auth.js';

describe('Auth Property Tests', () => {
  // **Feature: web-ui-upgrade, Property 2: Password Hashing Security**
  // **Validates: Requirements 1.6**
  describe('Property 2: Password Hashing Security', () => {
    it('hashed password should never equal plaintext password', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 6, maxLength: 50 }),
          async (password) => {
            const hash = await hashPassword(password);
            // The hash should never equal the original password
            expect(hash).not.toBe(password);
            return true;
          }
        ),
        // bcrypt is intentionally slow, so we reduce iterations but still test the property
        { numRuns: 10 }
      );
    }, 60000); // 60 second timeout for bcrypt operations

    it('hashed password should be a valid bcrypt hash', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 6, maxLength: 50 }),
          async (password) => {
            const hash = await hashPassword(password);
            // The hash should be a valid bcrypt hash format
            expect(isValidBcryptHash(hash)).toBe(true);
            return true;
          }
        ),
        // bcrypt is intentionally slow, so we reduce iterations but still test the property
        { numRuns: 10 }
      );
    }, 60000); // 60 second timeout for bcrypt operations
  });
});


// Helper to clean up test users
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { register, login, AuthError } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USERS_FILE = join(__dirname, '../data/users.json');

async function cleanupTestUsers(): Promise<void> {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: [] }), 'utf-8');
  } catch {
    // File may not exist
  }
}

describe('Auth Property Tests - Authentication', () => {
  // **Feature: web-ui-upgrade, Property 4: Valid Login Returns Session**
  // **Validates: Requirements 1.2**
  describe('Property 4: Valid Login Returns Session', () => {
    it('valid credentials should return a session with token', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Make username unique per iteration to avoid conflicts
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register user first
            const user = await register(username, password);
            
            // Login with valid credentials
            const session = await login(username, password);
            
            // Session should have valid structure
            expect(session).toBeDefined();
            expect(session.userId).toBe(user.id);
            expect(typeof session.token).toBe('string');
            expect(session.token.length).toBeGreaterThan(0);
            expect(session.expiresAt).toBeGreaterThan(Date.now());
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });

  // **Feature: web-ui-upgrade, Property 5: Invalid Login Rejected**
  // **Validates: Requirements 1.3**
  describe('Property 5: Invalid Login Rejected', () => {
    it('non-existent username should be rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Make username unique per iteration to avoid conflicts
            const username = `nonexistent_${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Try to login without registering
            try {
              await login(username, password);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(AuthError);
              expect((error as AuthError).code).toBe('INVALID_CREDENTIALS');
            }
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);

    it('wrong password should be rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, correctPassword, wrongPassword, uniqueId) => {
            // Skip if passwords happen to be the same
            if (correctPassword === wrongPassword) return true;
            
            // Make username unique per iteration to avoid conflicts
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register user
            await register(username, correctPassword);
            
            // Try to login with wrong password
            try {
              await login(username, wrongPassword);
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error).toBeInstanceOf(AuthError);
              expect((error as AuthError).code).toBe('INVALID_CREDENTIALS');
            }
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });
});


import { validateToken, logout } from './auth.js';

describe('Auth Property Tests - Session Management', () => {
  // **Feature: web-ui-upgrade, Property 6: Session Token Validity**
  // **Validates: Requirements 1.5**
  describe('Property 6: Session Token Validity', () => {
    it('valid session token should return the associated user', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Make username unique per iteration to avoid conflicts
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register and login
            const registeredUser = await register(username, password);
            const session = await login(username, password);
            
            // Validate token should return the user
            const user = await validateToken(session.token);
            
            expect(user).not.toBeNull();
            expect(user!.id).toBe(registeredUser.id);
            expect(user!.username).toBe(registeredUser.username);
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);

    it('invalid token should return null', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (fakeToken) => {
            // Validate a random token that was never issued
            const user = await validateToken(fakeToken);
            
            expect(user).toBeNull();
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });

  // **Feature: web-ui-upgrade, Property 7: Logout Invalidates Session**
  // **Validates: Requirements 1.4**
  describe('Property 7: Logout Invalidates Session', () => {
    it('after logout, session token should no longer be valid', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Make username unique per iteration to avoid conflicts
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register and login
            await register(username, password);
            const session = await login(username, password);
            
            // Verify token is valid before logout
            const userBefore = await validateToken(session.token);
            expect(userBefore).not.toBeNull();
            
            // Logout
            await logout(session.token);
            
            // Verify token is invalid after logout
            const userAfter = await validateToken(session.token);
            expect(userAfter).toBeNull();
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });
});
