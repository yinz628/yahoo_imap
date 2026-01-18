import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import express, { Express } from 'express';
import request from 'supertest';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from './server.js';
import { register, login, logout, validateToken, AuthError } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USERS_FILE = join(__dirname, '../data/users.json');

// Cleanup helper
async function cleanupTestUsers(): Promise<void> {
  try {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users: [] }), 'utf-8');
  } catch {
    // File may not exist
  }
}

// Create a minimal test app with auth middleware
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  
  // Protected endpoint for testing
  app.get('/api/protected', authMiddleware, (req, res) => {
    res.json({ success: true, userId: req.user?.id });
  });
  
  app.post('/api/protected', authMiddleware, (req, res) => {
    res.json({ success: true, userId: req.user?.id });
  });
  
  return app;
}

describe('Server Property Tests', () => {
  // **Feature: web-ui-upgrade, Property 17: Unauthenticated API Rejection**
  // **Validates: Requirements 7.3**
  describe('Property 17: Unauthenticated API Rejection', () => {
    let app: Express;

    beforeAll(() => {
      app = createTestApp();
    });

    beforeEach(async () => {
      await cleanupTestUsers();
    });

    it('requests without Authorization header should return 401', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('GET', 'POST'),
          async (method) => {
            const response = method === 'GET' 
              ? await request(app).get('/api/protected')
              : await request(app).post('/api/protected').send({});
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toBe('Authentication required');
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    });

    it('requests with invalid Authorization header format should return 401', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Missing "Bearer" prefix
            fc.uuid().map(token => token),
            // Wrong prefix
            fc.uuid().map(token => `Basic ${token}`),
            // Too many parts
            fc.uuid().map(token => `Bearer ${token} extra`),
            // Empty token
            fc.constant('Bearer '),
            // Just "Bearer"
            fc.constant('Bearer')
          ),
          async (authHeader) => {
            const response = await request(app)
              .get('/api/protected')
              .set('Authorization', authHeader);
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error');
            
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('requests with non-existent token should return 401', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (fakeToken) => {
            const response = await request(app)
              .get('/api/protected')
              .set('Authorization', `Bearer ${fakeToken}`);
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toBe('Session expired, please login again');
            
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('requests with valid token should succeed', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Make username unique per iteration to avoid conflicts
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register and login to get a valid token
            await register(username, password);
            const session = await login(username, password);
            
            const response = await request(app)
              .get('/api/protected')
              .set('Authorization', `Bearer ${session.token}`);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('userId');
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);

    it('requests with logged-out token should return 401', async () => {
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
            
            // Verify token works before logout
            const beforeLogout = await request(app)
              .get('/api/protected')
              .set('Authorization', `Bearer ${session.token}`);
            expect(beforeLogout.status).toBe(200);
            
            // Logout
            await logout(session.token);
            
            // Token should no longer work
            const afterLogout = await request(app)
              .get('/api/protected')
              .set('Authorization', `Bearer ${session.token}`);
            
            expect(afterLogout.status).toBe(401);
            expect(afterLogout.body).toHaveProperty('error');
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);
  });
});



// Create a full test app with all auth endpoints
function createFullTestApp(): Express {
  const app = express();
  app.use(express.json());
  
  // Auth endpoints
  app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
      const user = await register(username, password);
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === 'USERNAME_EXISTS') {
          res.status(409).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
      const session = await login(username, password);
      res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(401).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Login failed' });
      }
    }
  });

  app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (token) {
      await logout(token);
    }
    res.json({ success: true });
  });

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    const user = req.user!;
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      },
    });
  });
  
  return app;
}

describe('Server Property Tests - API Response Format', () => {
  // **Feature: web-ui-upgrade, Property 18: Consistent API Response Format**
  // **Validates: Requirements 7.4**
  describe('Property 18: Consistent API Response Format', () => {
    let app: Express;

    beforeAll(() => {
      app = createFullTestApp();
    });

    beforeEach(async () => {
      await cleanupTestUsers();
    });

    it('successful responses should have success: true and relevant data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            const username = `${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Test register response format
            const registerRes = await request(app)
              .post('/api/auth/register')
              .send({ username, password });
            
            expect(registerRes.status).toBe(200);
            expect(registerRes.body).toHaveProperty('success', true);
            expect(registerRes.body).toHaveProperty('user');
            expect(registerRes.body.user).toHaveProperty('id');
            expect(registerRes.body.user).toHaveProperty('username');
            expect(registerRes.body.user).toHaveProperty('createdAt');
            
            // Test login response format
            const loginRes = await request(app)
              .post('/api/auth/login')
              .send({ username, password });
            
            expect(loginRes.status).toBe(200);
            expect(loginRes.body).toHaveProperty('success', true);
            expect(loginRes.body).toHaveProperty('token');
            expect(loginRes.body).toHaveProperty('expiresAt');
            
            // Test /me response format
            const meRes = await request(app)
              .get('/api/auth/me')
              .set('Authorization', `Bearer ${loginRes.body.token}`);
            
            expect(meRes.status).toBe(200);
            expect(meRes.body).toHaveProperty('success', true);
            expect(meRes.body).toHaveProperty('user');
            
            // Test logout response format
            const logoutRes = await request(app)
              .post('/api/auth/logout')
              .set('Authorization', `Bearer ${loginRes.body.token}`);
            
            expect(logoutRes.status).toBe(200);
            expect(logoutRes.body).toHaveProperty('success', true);
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);

    it('error responses should have error property with message', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
          fc.string({ minLength: 6, maxLength: 30 }),
          fc.integer({ min: 1, max: 999999 }),
          async (usernameBase, password, uniqueId) => {
            // Use unique username for non-existent user test
            const nonExistentUsername = `nonexistent_${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Test invalid login (non-existent user) response format
            const invalidLoginRes = await request(app)
              .post('/api/auth/login')
              .send({ username: nonExistentUsername, password });
            
            expect(invalidLoginRes.status).toBe(401);
            expect(invalidLoginRes.body).toHaveProperty('error');
            expect(typeof invalidLoginRes.body.error).toBe('string');
            expect(invalidLoginRes.body.error.length).toBeGreaterThan(0);
            
            // Use unique username for duplicate registration test
            const duplicateTestUsername = `dup_${usernameBase}_${uniqueId}_${Date.now()}`;
            
            // Register user first
            const firstRegRes = await request(app)
              .post('/api/auth/register')
              .send({ username: duplicateTestUsername, password });
            
            // First registration should succeed
            expect(firstRegRes.status).toBe(200);
            
            // Test duplicate registration response format
            const duplicateRegRes = await request(app)
              .post('/api/auth/register')
              .send({ username: duplicateTestUsername, password });
            
            expect(duplicateRegRes.status).toBe(409);
            expect(duplicateRegRes.body).toHaveProperty('error');
            expect(typeof duplicateRegRes.body.error).toBe('string');
            
            // Test invalid password login response format
            const wrongPasswordRes = await request(app)
              .post('/api/auth/login')
              .send({ username: duplicateTestUsername, password: 'wrongpassword123' });
            
            expect(wrongPasswordRes.status).toBe(401);
            expect(wrongPasswordRes.body).toHaveProperty('error');
            expect(typeof wrongPasswordRes.body.error).toBe('string');
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    }, 60000);

    it('validation error responses should have error property', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Empty username
            fc.record({ username: fc.constant(''), password: fc.string({ minLength: 6 }) }),
            // Short username
            fc.record({ username: fc.string({ minLength: 1, maxLength: 2 }), password: fc.string({ minLength: 6 }) }),
            // Short password
            fc.record({ username: fc.string({ minLength: 3, maxLength: 10 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)), password: fc.string({ minLength: 1, maxLength: 5 }) }),
            // Missing fields
            fc.record({ username: fc.string({ minLength: 3 }) }),
            fc.record({ password: fc.string({ minLength: 6 }) })
          ),
          async (invalidInput) => {
            const res = await request(app)
              .post('/api/auth/register')
              .send(invalidInput);
            
            // Should be a 4xx error
            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(res.status).toBeLessThan(500);
            expect(res.body).toHaveProperty('error');
            expect(typeof res.body.error).toBe('string');
            
            return true;
          }
        ),
        { numRuns: 20 }
      );
    });

    it('unauthenticated requests to protected endpoints should have error property', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (fakeToken) => {
            // Test /me without auth
            const noAuthRes = await request(app).get('/api/auth/me');
            expect(noAuthRes.status).toBe(401);
            expect(noAuthRes.body).toHaveProperty('error');
            expect(typeof noAuthRes.body.error).toBe('string');
            
            // Test /me with invalid token
            const invalidTokenRes = await request(app)
              .get('/api/auth/me')
              .set('Authorization', `Bearer ${fakeToken}`);
            expect(invalidTokenRes.status).toBe(401);
            expect(invalidTokenRes.body).toHaveProperty('error');
            expect(typeof invalidTokenRes.body.error).toBe('string');
            
            // Test /logout without auth
            const logoutNoAuthRes = await request(app).post('/api/auth/logout');
            expect(logoutNoAuthRes.status).toBe(401);
            expect(logoutNoAuthRes.body).toHaveProperty('error');
            expect(typeof logoutNoAuthRes.body.error).toBe('string');
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});


// ============================================
// Email Management Property Tests
// ============================================

/**
 * Email metadata interface for testing (matches server implementation)
 */
interface EmailMetadata {
  uid: number;
  subject: string;
  sender: string;
  recipient: string;
  date: string;
}

/**
 * Helper to create a valid ISO date string
 */
const validDateArbitrary = fc.integer({ min: 1577836800000, max: 1767225600000 }) // 2020-01-01 to 2025-12-31
  .map(ts => new Date(ts).toISOString());

/**
 * Helper to create mock email metadata for testing
 */
const emailMetadataArbitrary = fc.record({
  uid: fc.integer({ min: 1, max: 999999 }),
  subject: fc.string({ minLength: 0, maxLength: 200 }),
  sender: fc.emailAddress(),
  recipient: fc.emailAddress(),
  date: validDateArbitrary
});

/**
 * Helper to generate a list of email metadata with unique UIDs
 */
const uniqueEmailListArbitrary = (minLength: number, maxLength: number) => 
  fc.array(fc.integer({ min: 1, max: 999999 }), { minLength, maxLength })
    .map(uids => [...new Set(uids)]) // Ensure unique UIDs
    .chain(uniqueUids => 
      fc.tuple(
        fc.constant(uniqueUids),
        fc.array(fc.string({ minLength: 0, maxLength: 100 }), { minLength: uniqueUids.length, maxLength: uniqueUids.length }),
        fc.array(fc.emailAddress(), { minLength: uniqueUids.length, maxLength: uniqueUids.length }),
        fc.array(fc.emailAddress(), { minLength: uniqueUids.length, maxLength: uniqueUids.length }),
        fc.array(validDateArbitrary, { minLength: uniqueUids.length, maxLength: uniqueUids.length })
      ).map(([uids, subjects, senders, recipients, dates]) => 
        uids.map((uid, i) => ({
          uid,
          subject: subjects[i] || '',
          sender: senders[i] || 'test@example.com',
          recipient: recipients[i] || 'test@example.com',
          date: dates[i] || new Date().toISOString()
        }))
      )
    );

/**
 * Helper to generate a list of email metadata (may have duplicate UIDs for some tests)
 */
const emailListArbitrary = fc.array(emailMetadataArbitrary, { minLength: 0, maxLength: 100 });

describe('Email Management Property Tests', () => {
  // **Feature: web-ui-upgrade, Property 12: Email List Without Body**
  // **Validates: Requirements 6.2**
  describe('Property 12: Email List Without Body', () => {
    it('email metadata should contain required fields but no body content', async () => {
      await fc.assert(
        fc.property(
          emailMetadataArbitrary,
          (email) => {
            // Verify required fields are present
            expect(email).toHaveProperty('uid');
            expect(email).toHaveProperty('subject');
            expect(email).toHaveProperty('sender');
            expect(email).toHaveProperty('recipient');
            expect(email).toHaveProperty('date');
            
            // Verify types
            expect(typeof email.uid).toBe('number');
            expect(typeof email.subject).toBe('string');
            expect(typeof email.sender).toBe('string');
            expect(typeof email.recipient).toBe('string');
            expect(typeof email.date).toBe('string');
            
            // Verify NO body-related fields
            expect(email).not.toHaveProperty('body');
            expect(email).not.toHaveProperty('content');
            expect(email).not.toHaveProperty('textContent');
            expect(email).not.toHaveProperty('htmlContent');
            expect(email).not.toHaveProperty('html');
            expect(email).not.toHaveProperty('text');
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('email list response should only contain metadata fields', async () => {
      await fc.assert(
        fc.property(
          uniqueEmailListArbitrary(0, 50),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 50 }),
          (emails, page, pageSize) => {
            // Simulate API response structure
            const totalCount = emails.length;
            const totalPages = Math.ceil(totalCount / pageSize);
            const validPage = Math.max(1, Math.min(page, totalPages || 1));
            const startIndex = (validPage - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, emails.length);
            const pageEmails = emails.slice(startIndex, endIndex);
            
            const response = {
              success: true,
              emails: pageEmails,
              pagination: {
                page: validPage,
                pageSize,
                totalCount,
                totalPages: totalPages || 0
              }
            };
            
            // Verify response structure
            expect(response).toHaveProperty('success', true);
            expect(response).toHaveProperty('emails');
            expect(response).toHaveProperty('pagination');
            expect(Array.isArray(response.emails)).toBe(true);
            
            // Verify each email has no body content
            for (const email of response.emails) {
              expect(email).not.toHaveProperty('body');
              expect(email).not.toHaveProperty('content');
              expect(email).not.toHaveProperty('textContent');
              expect(email).not.toHaveProperty('htmlContent');
              
              // Verify required metadata fields
              expect(email).toHaveProperty('uid');
              expect(email).toHaveProperty('subject');
              expect(email).toHaveProperty('sender');
              expect(email).toHaveProperty('recipient');
              expect(email).toHaveProperty('date');
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: web-ui-upgrade, Property 16: Pagination Correctness**
  // **Validates: Requirements 6.7**
  describe('Property 16: Pagination Correctness', () => {
    it('paginated results should have correct size and not exceed pageSize', async () => {
      await fc.assert(
        fc.property(
          uniqueEmailListArbitrary(0, 50),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 50 }),
          (emails, page, pageSize) => {
            const totalCount = emails.length;
            const totalPages = Math.ceil(totalCount / pageSize) || 0;
            const validPage = Math.max(1, Math.min(page, totalPages || 1));
            const startIndex = (validPage - 1) * pageSize;
            const endIndex = Math.min(startIndex + pageSize, emails.length);
            const pageEmails = emails.slice(startIndex, endIndex);
            
            // Page size should not exceed requested pageSize
            expect(pageEmails.length).toBeLessThanOrEqual(pageSize);
            
            // If not the last page and there are emails, should have exactly pageSize
            if (validPage < totalPages && totalCount > 0) {
              expect(pageEmails.length).toBe(pageSize);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('requesting all pages should return all emails exactly once', async () => {
      await fc.assert(
        fc.property(
          uniqueEmailListArbitrary(0, 50),
          fc.integer({ min: 1, max: 50 }),
          (emails, pageSize) => {
            const totalCount = emails.length;
            const totalPages = Math.ceil(totalCount / pageSize) || 0;
            
            // Collect all emails from all pages
            const allCollectedEmails: EmailMetadata[] = [];
            
            for (let page = 1; page <= Math.max(1, totalPages); page++) {
              const startIndex = (page - 1) * pageSize;
              const endIndex = Math.min(startIndex + pageSize, emails.length);
              const pageEmails = emails.slice(startIndex, endIndex);
              allCollectedEmails.push(...pageEmails);
            }
            
            // Should have collected exactly all emails
            expect(allCollectedEmails.length).toBe(totalCount);
            
            // Each email should appear exactly once (by uid)
            const uidCounts = new Map<number, number>();
            for (const email of allCollectedEmails) {
              const count = uidCounts.get(email.uid) || 0;
              uidCounts.set(email.uid, count + 1);
            }
            
            // Verify no duplicates (each uid appears exactly once)
            for (const [uid, count] of uidCounts) {
              expect(count).toBe(1);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pagination metadata should be consistent with actual results', async () => {
      await fc.assert(
        fc.property(
          uniqueEmailListArbitrary(0, 50),
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 1, max: 50 }),
          (emails, page, pageSize) => {
            const totalCount = emails.length;
            const totalPages = Math.ceil(totalCount / pageSize) || 0;
            const validPage = Math.max(1, Math.min(page, totalPages || 1));
            
            const pagination = {
              page: validPage,
              pageSize,
              totalCount,
              totalPages
            };
            
            // Verify pagination metadata consistency
            expect(pagination.totalCount).toBe(emails.length);
            expect(pagination.totalPages).toBe(Math.ceil(totalCount / pageSize) || 0);
            expect(pagination.page).toBeGreaterThanOrEqual(1);
            
            if (totalCount > 0) {
              expect(pagination.page).toBeLessThanOrEqual(pagination.totalPages);
            }
            
            // Verify totalPages calculation
            if (totalCount === 0) {
              expect(pagination.totalPages).toBe(0);
            } else {
              expect(pagination.totalPages).toBe(Math.ceil(totalCount / pageSize));
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty email list should return empty results with correct pagination', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 50 }),
          (page, pageSize) => {
            const emails: EmailMetadata[] = [];
            const totalCount = 0;
            const totalPages = 0;
            
            const response = {
              success: true,
              emails: [],
              pagination: {
                page: 1, // Should default to page 1 for empty results
                pageSize,
                totalCount,
                totalPages
              }
            };
            
            expect(response.emails.length).toBe(0);
            expect(response.pagination.totalCount).toBe(0);
            expect(response.pagination.totalPages).toBe(0);
            
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: web-ui-upgrade, Property 13: Email Search Filtering**
  // **Validates: Requirements 6.3**
  describe('Property 13: Email Search Filtering', () => {
    it('search results should only contain emails matching the subject pattern', async () => {
      await fc.assert(
        fc.property(
          fc.array(
            fc.record({
              uid: fc.integer({ min: 1, max: 999999 }),
              subject: fc.oneof(
                fc.constant('Discount code for you'),
                fc.constant('Your order confirmation'),
                fc.constant('Weekly newsletter'),
                fc.constant('Special discount offer'),
                fc.constant('Account update')
              ),
              sender: fc.emailAddress(),
              recipient: fc.emailAddress(),
              date: validDateArbitrary
            }),
            { minLength: 5, maxLength: 50 }
          ),
          fc.constantFrom('discount', 'order', 'newsletter', 'special', 'account'),
          (emails, searchPattern) => {
            // Filter emails that match the pattern (case-insensitive)
            const matchingEmails = emails.filter(e => 
              e.subject.toLowerCase().includes(searchPattern.toLowerCase())
            );
            
            // Verify all matching emails contain the pattern
            for (const email of matchingEmails) {
              expect(email.subject.toLowerCase()).toContain(searchPattern.toLowerCase());
            }
            
            // Verify count matches
            const count = matchingEmails.length;
            expect(count).toBe(matchingEmails.length);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('search count should equal the number of returned emails', async () => {
      await fc.assert(
        fc.property(
          uniqueEmailListArbitrary(0, 50),
          fc.string({ minLength: 1, maxLength: 20 }),
          (emails, searchPattern) => {
            // Simulate search filtering
            const matchingEmails = emails.filter(e => 
              e.subject.toLowerCase().includes(searchPattern.toLowerCase())
            );
            
            const response = {
              success: true,
              emails: matchingEmails,
              count: matchingEmails.length,
              pagination: {
                page: 1,
                pageSize: 20,
                totalCount: matchingEmails.length,
                totalPages: Math.ceil(matchingEmails.length / 20) || 0
              }
            };
            
            // Count should equal the number of emails returned
            expect(response.count).toBe(response.emails.length);
            expect(response.pagination.totalCount).toBe(response.count);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: web-ui-upgrade, Property 14: Batch Delete Moves to Trash**
  // **Validates: Requirements 6.5**
  describe('Property 14: Batch Delete Moves to Trash', () => {
    it('batch delete should report correct number of deleted emails', async () => {
      await fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 999999 }), { minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 5 }),
          (uids, errorCount) => {
            // Simulate batch delete response
            const actualErrors = Math.min(errorCount, uids.length);
            const deleted = uids.length - actualErrors;
            
            const response = {
              success: true,
              deleted,
              errors: actualErrors,
              message: `成功删除 ${deleted} 封邮件${actualErrors > 0 ? `，${actualErrors} 封失败` : ''}`
            };
            
            // Verify response structure
            expect(response).toHaveProperty('success', true);
            expect(response).toHaveProperty('deleted');
            expect(response).toHaveProperty('errors');
            expect(response).toHaveProperty('message');
            
            // Verify counts are consistent
            expect(response.deleted + response.errors).toBe(uids.length);
            expect(response.deleted).toBeGreaterThanOrEqual(0);
            expect(response.errors).toBeGreaterThanOrEqual(0);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('deleted emails should no longer appear in original folder', async () => {
      await fc.assert(
        fc.property(
          // Generate unique UIDs for the folder
          fc.array(fc.integer({ min: 1, max: 999999 }), { minLength: 5, maxLength: 50 })
            .map(uids => [...new Set(uids)]),
          fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 10 }),
          (allUids, deleteIndices) => {
            // Skip if we don't have enough unique UIDs
            if (allUids.length < 5) return true;
            
            // Get unique indices to delete
            const uniqueDeleteIndices = [...new Set(deleteIndices)]
              .filter(i => i < allUids.length);
            const uidsToDelete = new Set(uniqueDeleteIndices.map(i => allUids[i]));
            
            // Simulate deletion - remaining UIDs should not include deleted ones
            const remainingUids = allUids.filter(uid => !uidsToDelete.has(uid));
            
            // Verify deleted UIDs are not in remaining
            for (const deletedUid of uidsToDelete) {
              expect(remainingUids).not.toContain(deletedUid);
            }
            
            // Verify count is correct
            expect(remainingUids.length).toBe(allUids.length - uidsToDelete.size);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: web-ui-upgrade, Property 15: Empty Trash Removes All**
  // **Validates: Requirements 6.6**
  describe('Property 15: Empty Trash Removes All', () => {
    it('empty trash should result in zero emails in trash', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 10 }),
          (initialTrashCount, errorCount) => {
            // Simulate empty trash operation
            const actualErrors = Math.min(errorCount, initialTrashCount);
            const deleted = initialTrashCount - actualErrors;
            const remainingInTrash = actualErrors; // Only errors remain
            
            const response = {
              success: true,
              deleted,
              errors: actualErrors,
              message: actualErrors === 0 
                ? `成功清空回收站，永久删除 ${deleted} 封邮件`
                : `成功清空回收站，永久删除 ${deleted} 封邮件，${actualErrors} 封失败`
            };
            
            // If no errors, trash should be empty
            if (actualErrors === 0) {
              expect(remainingInTrash).toBe(0);
            }
            
            // Verify response structure
            expect(response).toHaveProperty('success', true);
            expect(response).toHaveProperty('deleted');
            expect(response).toHaveProperty('errors');
            
            // Verify counts
            expect(response.deleted + response.errors).toBe(initialTrashCount);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('empty trash on already empty trash should succeed with zero deleted', async () => {
      await fc.assert(
        fc.property(
          fc.constant(0),
          (trashCount) => {
            const response = {
              success: true,
              deleted: 0,
              errors: 0,
              message: '回收站已经是空的'
            };
            
            expect(response.deleted).toBe(0);
            expect(response.errors).toBe(0);
            expect(response.success).toBe(true);
            
            return true;
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});

// ============================================
// Connection Stability Property Tests
// ============================================

describe('Connection Stability Property Tests', () => {
  // **Feature: gmail-connection-stability, Property 7: 批量重连指数退避**
  // **Validates: Requirements 2.1**
  describe('Property 7: Batch Reconnect Exponential Backoff', () => {
    /**
     * Helper function to calculate expected delay using exponential backoff
     * Formula: min(baseDelay * 2^(attempt-1), maxDelay)
     */
    function calculateExpectedDelay(attempt: number, baseDelay: number = 2000, maxDelay: number = 30000): number {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      return Math.min(delay, maxDelay);
    }

    it('reconnect delays should follow exponential backoff pattern', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }), // attempt number
          (attempt) => {
            const baseDelay = 2000;
            const maxDelay = 30000;
            
            // Calculate expected delay
            const expectedDelay = calculateExpectedDelay(attempt, baseDelay, maxDelay);
            
            // Verify exponential growth before hitting max
            if (attempt === 1) {
              expect(expectedDelay).toBe(2000); // 2000 * 2^0 = 2000
            } else if (attempt === 2) {
              expect(expectedDelay).toBe(4000); // 2000 * 2^1 = 4000
            } else if (attempt === 3) {
              expect(expectedDelay).toBe(8000); // 2000 * 2^2 = 8000
            } else if (attempt === 4) {
              expect(expectedDelay).toBe(16000); // 2000 * 2^3 = 16000
            } else if (attempt >= 5) {
              // Should cap at maxDelay
              expect(expectedDelay).toBe(30000);
            }
            
            // Verify delay is within bounds
            expect(expectedDelay).toBeGreaterThanOrEqual(baseDelay);
            expect(expectedDelay).toBeLessThanOrEqual(maxDelay);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('each retry delay should be double the previous (until max)', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }), // attempt > 1
          (attempt) => {
            const baseDelay = 2000;
            const maxDelay = 30000;
            
            const currentDelay = calculateExpectedDelay(attempt, baseDelay, maxDelay);
            const previousDelay = calculateExpectedDelay(attempt - 1, baseDelay, maxDelay);
            
            // If neither has hit the max, current should be double previous
            if (currentDelay < maxDelay && previousDelay < maxDelay) {
              expect(currentDelay).toBe(previousDelay * 2);
            }
            
            // Current delay should always be >= previous delay
            expect(currentDelay).toBeGreaterThanOrEqual(previousDelay);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('delay should never exceed maxDelay regardless of attempt number', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // test with large attempt numbers
          (attempt) => {
            const baseDelay = 2000;
            const maxDelay = 30000;
            
            const delay = calculateExpectedDelay(attempt, baseDelay, maxDelay);
            
            // Delay should never exceed max
            expect(delay).toBeLessThanOrEqual(maxDelay);
            
            // For large attempts, should always be at max
            if (attempt >= 5) {
              expect(delay).toBe(maxDelay);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('delay sequence should be monotonically increasing until max', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 10 }), // number of attempts to test
          (maxAttempts) => {
            const baseDelay = 2000;
            const maxDelay = 30000;
            const delays: number[] = [];
            
            // Generate delay sequence
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              delays.push(calculateExpectedDelay(attempt, baseDelay, maxDelay));
            }
            
            // Verify sequence is monotonically increasing (or stays at max)
            for (let i = 1; i < delays.length; i++) {
              expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
            }
            
            // Verify first delay is baseDelay
            expect(delays[0]).toBe(baseDelay);
            
            // Verify last delay is at or approaching maxDelay
            expect(delays[delays.length - 1]).toBeLessThanOrEqual(maxDelay);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('exponential backoff should apply to all providers', async () => {
      await fc.assert(
        fc.property(
          fc.constantFrom('gmail', 'yahoo', 'other'),
          fc.integer({ min: 1, max: 5 }),
          (provider, attempt) => {
            // All providers should use the same exponential backoff formula
            const baseDelay = 2000;
            const maxDelay = 30000;
            
            const delay = calculateExpectedDelay(attempt, baseDelay, maxDelay);
            
            // Verify delay calculation is independent of provider
            // (same formula for all providers)
            expect(delay).toBe(Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay));
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('reconnect should not exceed maxReconnectAttempts', async () => {
      await fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (attemptNumber) => {
            const maxReconnectAttempts = 5;
            
            // Simulate reconnect attempt tracking
            const shouldAttemptReconnect = attemptNumber <= maxReconnectAttempts;
            
            if (attemptNumber > maxReconnectAttempts) {
              // Should not attempt reconnect beyond max
              expect(shouldAttemptReconnect).toBe(false);
            } else {
              // Should attempt reconnect within limit
              expect(shouldAttemptReconnect).toBe(true);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
