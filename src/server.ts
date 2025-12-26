import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { IMAPConnector, YAHOO_IMAP_DEFAULTS, GMAIL_IMAP_DEFAULTS, getIMAPSettings, detectEmailProvider, type EmailProvider } from './connector.js';
import { EmailFetcher, EmailDeleter } from './fetcher.js';
import { EmailParser } from './parser.js';
import { RegexExtractor } from './extractor.js';
import { CSVExporter } from './exporters/csv.js';
import { ExcelExporter } from './exporters/excel.js';
import { SQLiteExporter } from './exporters/sqlite.js';
import { register, login, logout, validateToken, AuthError, User, ensureDefaultUser } from './auth.js';
import {
  getMailboxes,
  saveMailbox,
  updateMailbox,
  deleteMailbox,
  decryptPassword,
  getPatterns,
  savePattern,
  deletePattern,
  updatePattern,
  updatePatternLastUsed,
  StorageError,
  ValidationError,
} from './storage.js';
import { generateFromTarget, validateRegex, testRegexMatch } from './regex-generator.js';
import type { IMAPConfig, FetchFilter, ExtractionPattern, ExtractionResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// Logging Setup
// ============================================

// Check if --log flag is passed
const enableFileLogging = process.argv.includes('--log');

if (enableFileLogging) {
  // Create logs directory if it doesn't exist
  const logsDir = join(__dirname, '../logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Create log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFile = join(logsDir, `server-${timestamp}.log`);
  const logStream = createWriteStream(logFile, { flags: 'a' });

  // Override console methods to also write to file
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  const formatLogMessage = (level: string, args: unknown[]) => {
    const time = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    return `[${time}] [${level}] ${message}\n`;
  };

  console.log = (...args: unknown[]) => {
    originalConsoleLog.apply(console, args);
    logStream.write(formatLogMessage('INFO', args));
  };

  console.error = (...args: unknown[]) => {
    originalConsoleError.apply(console, args);
    logStream.write(formatLogMessage('ERROR', args));
  };

  console.warn = (...args: unknown[]) => {
    originalConsoleWarn.apply(console, args);
    logStream.write(formatLogMessage('WARN', args));
  };

  console.log(`[Server] Logging to file: ${logFile}`);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Store active connections with metadata
interface ConnectionSession {
  connector: IMAPConnector;
  connection: any;
  email: string;
  password: string;
  provider: EmailProvider;
  createdAt: number;
  lastActivity: number;
}

const connections = new Map<string, ConnectionSession>();

// Connection health check interval (every 2 minutes)
const HEALTH_CHECK_INTERVAL = 120000;
// Connection idle timeout (10 minutes)
const CONNECTION_IDLE_TIMEOUT = 600000;

// Periodic health check for all connections
setInterval(async () => {
  const now = Date.now();
  for (const [sessionId, session] of connections.entries()) {
    // Check if connection is idle for too long
    if (now - session.lastActivity > CONNECTION_IDLE_TIMEOUT) {
      console.log(`[Server] Session ${sessionId} idle for too long, disconnecting...`);
      try {
        await session.connector.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      connections.delete(sessionId);
      continue;
    }

    // Check connection health
    try {
      const healthy = await session.connector.checkHealth();
      if (!healthy) {
        console.log(`[Server] Session ${sessionId} unhealthy, will reconnect on next request`);
      }
    } catch {
      console.log(`[Server] Session ${sessionId} health check failed`);
    }
  }
}, HEALTH_CHECK_INTERVAL);

/**
 * Helper to ensure connection is healthy before operations
 */
async function ensureSessionConnected(sessionId: string): Promise<ConnectionSession | null> {
  const session = connections.get(sessionId);
  if (!session) {
    return null;
  }

  // Update activity timestamp
  session.lastActivity = Date.now();

  // Check if connection is healthy
  if (!session.connector.isConnected()) {
    console.log(`[Server] Session ${sessionId} disconnected, attempting reconnect...`);
    const imapSettings = getIMAPSettings(session.provider);
    const result = await session.connector.connect({
      email: session.email,
      password: session.password,
      host: imapSettings.host,
      port: imapSettings.port,
      tls: imapSettings.tls,
    });

    if (result.success && result.connection) {
      session.connection = result.connection;
      console.log(`[Server] Session ${sessionId} reconnected successfully`);
    } else {
      console.log(`[Server] Session ${sessionId} reconnection failed: ${result.error}`);
      connections.delete(sessionId);
      return null;
    }
  }

  return session;
}

// ============================================
// Authentication Middleware
// ============================================

/**
 * Authentication middleware - extracts token from Authorization header,
 * validates it, and attaches user to request.
 * Returns 401 for invalid/missing tokens.
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Extract token from "Bearer <token>" format
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Invalid authorization header format' });
    return;
  }

  const token = parts[1];
  
  try {
    const user = await validateToken(token);
    if (!user) {
      res.status(401).json({ error: 'Session expired, please login again' });
      return;
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid session token' });
  }
};

// ============================================
// Health Check and System Endpoints
// ============================================

// GET /health - Health check endpoint for Docker
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// GET /api/status - Detailed system status
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0',
    node_version: process.version
  });
});

// ============================================
// Authentication API Endpoints
// ============================================

// POST /api/auth/register - User registration
app.post('/api/auth/register', async (req: Request, res: Response) => {
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

// POST /api/auth/login - User login
app.post('/api/auth/login', async (req: Request, res: Response) => {
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

// POST /api/auth/logout - User logout
app.post('/api/auth/logout', authMiddleware, async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  if (token) {
    await logout(token);
  }
  
  res.json({ success: true });
});

// GET /api/auth/me - Get current user info
app.get('/api/auth/me', authMiddleware, async (req: Request, res: Response) => {
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

// ============================================
// Mailbox Management API Endpoints
// ============================================

// GET /api/mailboxes - List user mailboxes
app.get('/api/mailboxes', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    const mailboxes = await getMailboxes(userId);
    // Return mailboxes without exposing encrypted passwords
    const safeMailboxes = mailboxes.map(m => ({
      id: m.id,
      email: m.email,
      provider: m.provider || 'yahoo', // Default to yahoo for backward compatibility
      addedAt: m.addedAt,
      lastUsed: m.lastUsed,
    }));
    res.json({ success: true, mailboxes: safeMailboxes });
  } catch (error) {
    if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to retrieve mailboxes' });
    }
  }
});

// POST /api/mailboxes - Add new mailbox
app.post('/api/mailboxes', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { email, password, provider } = req.body;
  
  try {
    const mailbox = await saveMailbox(userId, { email, password, provider });
    // Return mailbox without exposing encrypted password
    res.json({
      success: true,
      mailbox: {
        id: mailbox.id,
        email: mailbox.email,
        provider: mailbox.provider,
        addedAt: mailbox.addedAt,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to save mailbox' });
    }
  }
});

// PUT /api/mailboxes/:id - Update mailbox
app.put('/api/mailboxes/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const mailboxId = req.params.id;
  const { email, password, provider } = req.body;
  
  try {
    const mailbox = await updateMailbox(userId, mailboxId, { email, password, provider });
    // Return mailbox without exposing encrypted password
    res.json({
      success: true,
      mailbox: {
        id: mailbox.id,
        email: mailbox.email,
        provider: mailbox.provider,
        addedAt: mailbox.addedAt,
        lastUsed: mailbox.lastUsed,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${mailboxId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update mailbox' });
    }
  }
});

// DELETE /api/mailboxes/:id - Delete mailbox
app.delete('/api/mailboxes/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const mailboxId = req.params.id;
  
  try {
    await deleteMailbox(userId, mailboxId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${mailboxId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to delete mailbox' });
    }
  }
});

// GET /api/mailboxes/:id/password - Get decrypted password for a mailbox (for auto-fill)
app.get('/api/mailboxes/:id/password', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const mailboxId = req.params.id;
  
  try {
    const mailboxes = await getMailboxes(userId);
    const mailbox = mailboxes.find(m => m.id === mailboxId);
    
    if (!mailbox) {
      res.status(404).json({ error: `Resource not found: ${mailboxId}` });
      return;
    }
    
    const password = decryptPassword(mailbox.encryptedPassword);
    res.json({ success: true, email: mailbox.email, password });
  } catch (error) {
    if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to retrieve password' });
    }
  }
});

// ============================================
// Pattern History API Endpoints
// ============================================

// GET /api/patterns - List user patterns
app.get('/api/patterns', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    const patterns = await getPatterns(userId);
    res.json({ success: true, patterns });
  } catch (error) {
    if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to retrieve patterns' });
    }
  }
});

// POST /api/patterns - Save new pattern
app.post('/api/patterns', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { patternName, subjectPattern, regexPattern, regexFlags, tags } = req.body;
  
  try {
    const pattern = await savePattern(userId, { patternName, subjectPattern, regexPattern, regexFlags, tags });
    res.json({ success: true, pattern });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to save pattern' });
    }
  }
});

// DELETE /api/patterns/:id - Delete pattern
app.delete('/api/patterns/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const patternId = req.params.id;
  
  try {
    await deletePattern(userId, patternId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${patternId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to delete pattern' });
    }
  }
});

// PUT /api/patterns/:id - Update pattern
app.put('/api/patterns/:id', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const patternId = req.params.id;
  const { patternName, subjectPattern, regexPattern, regexFlags, tags } = req.body;
  
  try {
    const pattern = await updatePattern(userId, patternId, { patternName, subjectPattern, regexPattern, regexFlags, tags });
    res.json({ success: true, pattern });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${patternId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update pattern' });
    }
  }
});

// POST /api/patterns/:id/use - Update pattern last used timestamp
app.post('/api/patterns/:id/use', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const patternId = req.params.id;
  
  try {
    await updatePatternLastUsed(userId, patternId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${patternId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update pattern' });
    }
  }
});

// PUT /api/patterns/:id/use - Update pattern last used timestamp
// Requirements: 5.4
app.put('/api/patterns/:id/use', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const patternId = req.params.id;
  
  try {
    await updatePatternLastUsed(userId, patternId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      res.status(404).json({ error: `Resource not found: ${patternId}` });
    } else if (error instanceof StorageError) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update pattern' });
    }
  }
});

// Connect endpoint - supports Yahoo and Gmail
app.post('/api/connect', async (req, res) => {
  const { email, password, provider: requestedProvider } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Detect or use specified provider
  const provider: EmailProvider = requestedProvider || detectEmailProvider(email);
  const imapSettings = getIMAPSettings(provider);

  const connector = new IMAPConnector();
  const config: IMAPConfig = {
    email,
    password,
    host: imapSettings.host,
    port: imapSettings.port,
    tls: imapSettings.tls,
  };

  try {
    const result = await connector.connect(config);
    if (result.success && result.connection) {
      const sessionId = Date.now().toString();
      const now = Date.now();
      connections.set(sessionId, {
        connector,
        connection: result.connection,
        email,
        password,
        provider,
        createdAt: now,
        lastActivity: now,
      });
      
      const folders = await connector.listFolders();
      res.json({ success: true, sessionId, folders, provider });
    } else {
      res.status(401).json({ error: result.error || 'Connection failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Disconnect endpoint
app.post('/api/disconnect', async (req, res) => {
  const { sessionId } = req.body;
  const session = connections.get(sessionId);
  
  if (session) {
    await session.connector.disconnect();
    connections.delete(sessionId);
  }
  res.json({ success: true });
});

// Count emails endpoint with timeout and auto-reconnect
app.post('/api/count', async (req, res) => {
  const { sessionId, filter } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const fetcher = new EmailFetcher();
  const fetchFilter: FetchFilter = {
    folder: filter.folder || 'INBOX',
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    sender: filter.sender || undefined,
    subject: filter.subject || undefined,
  };

  console.log(`[Count] Starting count with filter: ${JSON.stringify(fetchFilter)}`);

  try {
    const countPromise = fetcher.count(session.connection, fetchFilter);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Count operation timed out after 30 seconds')), 30000)
    );
    
    const count = await Promise.race([countPromise, timeoutPromise]);
    console.log(`[Count] Found ${count} emails`);
    res.json({ count });
  } catch (error) {
    console.error('[Count] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Preview first email endpoint
app.post('/api/preview', async (req, res) => {
  const { sessionId, filter } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const fetcher = new EmailFetcher();
  const parser = new EmailParser();

  const fetchFilter: FetchFilter = {
    folder: filter.folder || 'INBOX',
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    sender: filter.sender || undefined,
    subject: filter.subject || undefined,
  };

  try {
    console.log('[Preview] Fetching first email...');
    const emails = await fetcher.fetchLimited(session.connection, fetchFilter, 1);
    
    if (emails.length === 0) {
      console.log('[Preview] No emails found');
      return res.json({ content: null });
    }
    
    const rawEmail = emails[0];
    console.log('[Preview] Parsing email...');
    const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
    const content = parsed.textContent || parser.stripHtml(parsed.htmlContent || '');
    
    console.log(`[Preview] Done. Content length: ${content.length}`);
    return res.json({
      subject: parsed.subject,
      from: parsed.from,
      date: parsed.date.toISOString(),
      content: content,
      contentLength: content.length
    });
  } catch (error) {
    console.error('[Preview] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Extract endpoint - single-threaded with speed control and progress streaming
app.post('/api/extract', async (req, res) => {
  const { sessionId, filter, pattern, stripHtml, delayMs = 100 } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const extractor = new RegexExtractor();

  const fetchFilter: FetchFilter = {
    folder: filter.folder || 'INBOX',
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    sender: filter.sender || undefined,
    subject: filter.subject || undefined,
  };

  const extractionPattern: ExtractionPattern = {
    name: pattern.name || 'default',
    pattern: pattern.pattern,
    flags: pattern.flags || 'g',
  };

  console.log(`[Extract] Starting extraction with pattern: ${pattern.pattern}`);
  console.log(`[Extract] Filter: ${JSON.stringify(fetchFilter)}`);
  console.log(`[Extract] Delay: ${delayMs}ms, StripHtml: ${stripHtml}`);

  try {
    console.log('[Extract] Counting emails...');
    const totalCount = await fetcher.count(session.connection, fetchFilter);
    console.log(`[Extract] Found ${totalCount} emails`);
    
    const results: ExtractionResult[] = [];
    let processed = 0;
    let errors = 0;
    let totalMatches = 0;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ type: 'init', total: totalCount }) + '\n');

    if (totalCount === 0) {
      console.log('[Extract] No emails to process');
      res.write(JSON.stringify({ type: 'complete', results: [], processed: 0, errors: 0, totalMatches: 0 }) + '\n');
      res.end();
      return;
    }

    console.log('[Extract] Starting email processing...');
    for await (const rawEmail of fetcher.fetch(session.connection, fetchFilter)) {
      try {
        console.log(`[Extract] Processing email ${processed + 1}/${totalCount}: ${rawEmail.subject?.substring(0, 50)}...`);
        
        const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
        const result = extractor.extract(parsed, extractionPattern, stripHtml);
        results.push(result);
        
        const matchCount = result.matches.length;
        totalMatches += matchCount;
        
        console.log(`[Extract] Email ${processed + 1}: ${matchCount} matches found`);
        
        res.write(JSON.stringify({ 
          type: 'progress', 
          processed: processed + 1, 
          total: totalCount,
          matches: result.matches.map(m => ({
            fullMatch: m.fullMatch,
            groups: m.groups,
            subject: result.email.subject,
            from: result.email.from,
            date: result.email.date
          }))
        }) + '\n');
      } catch (error) {
        errors++;
        console.error(`[Extract] Error processing email ${processed + 1}:`, error);
        res.write(JSON.stringify({ 
          type: 'progress', 
          processed: processed + 1, 
          total: totalCount,
          error: error instanceof Error ? error.message : 'Unknown error'
        }) + '\n');
      }
      processed++;
      
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`[Extract] Complete: ${processed} emails, ${totalMatches} matches, ${errors} errors`);
    res.write(JSON.stringify({ type: 'complete', results, processed, errors, totalMatches }) + '\n');
    res.end();
  } catch (error) {
    console.error('[Extract] Endpoint error:', error);
    res.write(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Unknown error' }) + '\n');
    res.end();
  }
});

// Export endpoint
app.post('/api/export', async (req, res) => {
  const { results, format } = req.body;
  
  try {
    if (format === 'csv') {
      const exporter = new CSVExporter();
      const csv = exporter.serialize(results);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=extraction.csv');
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Only CSV export supported in web UI' });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Auto-generate regex from target string endpoint
// Requirements: 3.1, 3.3
app.post('/api/regex/generate', async (req, res) => {
  const { targetString, emailContent } = req.body;
  
  if (!targetString) {
    return res.status(400).json({ error: 'Target string is required' });
  }

  console.log(`[RegexGen] Target string: "${targetString}"`);
  if (emailContent) {
    console.log(`[RegexGen] Email content length: ${emailContent.length}`);
  }

  try {
    // Use the generateFromTarget function from regex-generator.ts
    const generated = generateFromTarget(targetString);
    
    // Build patterns array for frontend compatibility
    // Convert suggestions to patterns format expected by frontend
    const patterns: Array<{
      pattern: string;
      flags: string;
      name: string;
      description: string;
    }> = [];
    
    // Add suggestions as patterns
    if (generated.suggestions && generated.suggestions.length > 0) {
      generated.suggestions.forEach((suggestion, idx) => {
        patterns.push({
          pattern: suggestion.pattern,
          flags: 'gi', // Default to global + case-insensitive for alphanumeric patterns
          name: `建议规则 ${idx + 1}`,
          description: suggestion.description,
        });
      });
    }
    
    // Always add literal pattern as the last option
    patterns.push({
      pattern: generated.literal,
      flags: 'g',
      name: '字面匹配',
      description: '精确匹配目标字符串',
    });
    
    // Build response
    const response: {
      patterns: typeof patterns;
      literal: string;
      suggestions: typeof generated.suggestions;
      targetString: string;
      context?: string;
      foundAt?: number;
    } = {
      patterns,
      literal: generated.literal,
      suggestions: generated.suggestions,
      targetString,
    };

    // If email content is provided, find context around the target
    if (emailContent) {
      let index = emailContent.indexOf(targetString);
      
      // If not found, try case-insensitive search
      if (index === -1) {
        const lowerContent = emailContent.toLowerCase();
        const lowerTarget = targetString.toLowerCase();
        index = lowerContent.indexOf(lowerTarget);
      }

      if (index !== -1) {
        response.foundAt = index;
        const contextStart = Math.max(0, index - 100);
        const contextEnd = Math.min(emailContent.length, index + targetString.length + 100);
        response.context = emailContent.substring(contextStart, contextEnd);
      } else {
        response.context = '(目标字符串未在邮件中找到)';
        response.foundAt = -1;
      }
    }

    console.log(`[RegexGen] Generated literal: ${generated.literal}`);
    console.log(`[RegexGen] Generated ${patterns.length} patterns (including ${generated.suggestions.length} suggestions)`);

    res.json(response);
  } catch (error) {
    console.error('[RegexGen] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Validate regex syntax endpoint (simple validation without email connection)
// Requirements: 3.5, 4.4
app.post('/api/regex/validate-syntax', async (req, res) => {
  const { pattern, flags = '' } = req.body;
  
  if (!pattern) {
    return res.status(400).json({ error: 'Regex pattern is required' });
  }

  console.log(`[RegexValidate] Pattern: "${pattern}", Flags: "${flags}"`);

  try {
    const result = validateRegex(pattern, flags);
    
    console.log(`[RegexValidate] Valid: ${result.valid}`);
    if (!result.valid) {
      console.log(`[RegexValidate] Error: ${result.error}`);
    }

    res.json(result);
  } catch (error) {
    console.error('[RegexValidate] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Test regex against content endpoint
// Requirements: 4.3
app.post('/api/regex/test', async (req, res) => {
  const { pattern, flags = 'g', content } = req.body;
  
  if (!pattern) {
    return res.status(400).json({ error: 'Regex pattern is required' });
  }
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  console.log(`[RegexTest] Pattern: "${pattern}", Flags: "${flags}"`);
  console.log(`[RegexTest] Content length: ${content.length}`);

  try {
    // First validate the regex
    const validation = validateRegex(pattern, flags);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: validation.error || 'Invalid regex pattern',
        valid: false 
      });
    }

    // Test the regex against content
    const result = testRegexMatch(pattern, flags, content);
    
    console.log(`[RegexTest] Found ${result.matches.length} matches`);

    res.json({
      valid: true,
      matches: result.matches,
      positions: result.positions,
      matchCount: result.matches.length
    });
  } catch (error) {
    console.error('[RegexTest] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});


// Validate regex against multiple emails endpoint
app.post('/api/regex/validate', async (req, res) => {
  const { sessionId, filter, pattern, stripHtml, count = 3 } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const extractor = new RegexExtractor();

  const fetchFilter: FetchFilter = {
    folder: filter.folder || 'INBOX',
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    sender: filter.sender || undefined,
    subject: filter.subject || undefined,
  };

  const extractionPattern: ExtractionPattern = {
    name: pattern.name || 'test',
    pattern: pattern.pattern,
    flags: pattern.flags || 'g',
  };

  try {
    console.log(`[Validate] Starting validation for pattern: ${pattern.pattern}`);
    console.log(`[Validate] Filter: ${JSON.stringify(fetchFilter)}`);
    console.log(`[Validate] Fetching ${count} emails...`);

    const rawEmails = await fetcher.fetchLimited(session.connection, fetchFilter, count);
    console.log(`[Validate] Fetched ${rawEmails.length} emails`);

    const results: any[] = [];

    for (let i = 0; i < rawEmails.length; i++) {
      const rawEmail = rawEmails[i];
      try {
        console.log(`[Validate] Processing email ${i + 1}/${rawEmails.length}: ${rawEmail.subject?.substring(0, 50)}...`);
        
        const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
        const result = extractor.extract(parsed, extractionPattern, stripHtml);
        
        console.log(`[Validate] Found ${result.matches.length} matches`);
        
        results.push({
          subject: parsed.subject,
          from: parsed.from,
          date: parsed.date.toISOString(),
          matches: result.matches.slice(0, 10),
          matchCount: result.matches.length
        });
      } catch (error) {
        console.error(`[Validate] Error for email ${rawEmail.uid}:`, error);
        results.push({
          subject: rawEmail.subject || 'Error',
          error: error instanceof Error ? error.message : 'Unknown error',
          matchCount: 0
        });
      }
    }

    const successCount = results.filter(r => r.matchCount > 0).length;
    const totalMatches = results.reduce((sum, r) => sum + (r.matchCount || 0), 0);

    console.log(`[Validate] Complete: ${results.length} emails, ${successCount} successful, ${totalMatches} matches`);

    res.json({
      results,
      summary: {
        tested: results.length,
        successful: successCount,
        totalMatches,
        successRate: results.length > 0 ? Math.round((successCount / results.length) * 100) : 0
      }
    });
  } catch (error) {
    console.error('[Validate] Endpoint error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete emails matching filter
app.post('/api/delete', async (req, res) => {
  const { sessionId, filter } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const deleter = new EmailDeleter();
  const fetchFilter: FetchFilter = {
    folder: filter.folder || 'INBOX',
    dateFrom: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
    dateTo: filter.dateTo ? new Date(filter.dateTo) : undefined,
    sender: filter.sender || undefined,
    subject: filter.subject || undefined,
  };

  try {
    console.log(`[Delete] Starting deletion with filter: ${JSON.stringify(fetchFilter)}`);
    
    // First count matching emails
    const uids = await deleter.getMatchingUIDs(session.connection, fetchFilter);
    console.log(`[Delete] Found ${uids.length} emails to delete`);
    
    if (uids.length === 0) {
      return res.json({ deleted: 0, errors: 0, message: '没有找到匹配的邮件' });
    }

    // Delete emails
    const result = await deleter.deleteEmails(session.connection, fetchFilter);
    console.log(`[Delete] Deleted ${result.deleted} emails, ${result.errors} errors`);
    
    res.json({
      deleted: result.deleted,
      errors: result.errors,
      message: `成功删除 ${result.deleted} 封邮件${result.errors > 0 ? `，${result.errors} 封失败` : ''}`
    });
  } catch (error) {
    console.error('[Delete] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Empty trash folder
app.post('/api/empty-trash', async (req, res) => {
  const { sessionId } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const deleter = new EmailDeleter();

  try {
    console.log('[EmptyTrash] Starting...');
    
    // First get count
    const trashCount = await deleter.getTrashCount(session.connection);
    console.log(`[EmptyTrash] Found ${trashCount} emails in Trash`);
    
    if (trashCount === 0) {
      return res.json({ deleted: 0, errors: 0, message: '回收站已经是空的' });
    }

    // Empty trash
    const result = await deleter.emptyTrash(session.connection);
    console.log(`[EmptyTrash] Deleted ${result.deleted} emails, ${result.errors} errors`);
    
    res.json({
      deleted: result.deleted,
      errors: result.errors,
      message: `成功清空回收站，永久删除 ${result.deleted} 封邮件${result.errors > 0 ? `，${result.errors} 封失败` : ''}`
    });
  } catch (error) {
    console.error('[EmptyTrash] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get trash count
app.post('/api/trash-count', async (req, res) => {
  const { sessionId } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  const deleter = new EmailDeleter();

  try {
    const count = await deleter.getTrashCount(session.connection);
    if (count === -1) {
      // No trash folder found
      res.json({ count: 0, message: '未找到回收站文件夹（此邮箱可能没有回收站或使用不同的名称）' });
    } else {
      res.json({ count });
    }
  } catch (error) {
    console.error('[TrashCount] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================
// Email Management API Endpoints
// ============================================

/**
 * Email metadata interface for list responses (without body)
 */
interface EmailMetadata {
  uid: number;
  subject: string;
  sender: string;
  recipient: string;
  date: string;
}

/**
 * POST /api/emails/list - Get email list with metadata only (no body)
 * Supports pagination with page and pageSize params
 * Supports sorting by date with sortOrder param ('asc' or 'desc')
 * Requirements: 6.2, 6.7
 */
app.post('/api/emails/list', async (req, res) => {
  const { sessionId, folder = 'INBOX', page = 1, pageSize = 20, sortOrder = 'desc' } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  try {
    console.log(`[EmailList] Fetching emails from ${folder}, page ${page}, pageSize ${pageSize}, sortOrder ${sortOrder}`);
    
    const connection = session.connection;
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });
    
    try {
      // Get total count
      const status = await connection.status(folder, { messages: true });
      const totalCount = status.messages || 0;
      
      if (totalCount === 0) {
        return res.json({
          success: true,
          emails: [],
          pagination: {
            page,
            pageSize,
            totalCount: 0,
            totalPages: 0
          }
        });
      }
      
      // Calculate pagination
      const totalPages = Math.ceil(totalCount / pageSize);
      const validPage = Math.max(1, Math.min(page, totalPages));
      
      // Get all UIDs first (sorted by date, newest first)
      const allUids = await connection.search({}, { uid: true });
      
      if (allUids === false || allUids.length === 0) {
        return res.json({
          success: true,
          emails: [],
          pagination: {
            page: validPage,
            pageSize,
            totalCount: 0,
            totalPages: 0
          }
        });
      }
      
      // Sort UIDs based on sortOrder
      // UIDs are generally sequential, so higher UID = newer email
      const sortedUids = sortOrder === 'asc' 
        ? [...allUids].sort((a, b) => a - b)  // oldest first
        : [...allUids].sort((a, b) => b - a); // newest first (default)
      
      // Calculate slice for current page
      const startIndex = (validPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, sortedUids.length);
      const pageUids = sortedUids.slice(startIndex, endIndex);
      
      if (pageUids.length === 0) {
        return res.json({
          success: true,
          emails: [],
          pagination: {
            page: validPage,
            pageSize,
            totalCount,
            totalPages
          }
        });
      }
      
      // Fetch only envelope data (no body/source)
      const emails: EmailMetadata[] = [];
      const range = pageUids.join(',');
      
      for await (const message of connection.fetch(range, {
        uid: true,
        envelope: true
      }, { uid: true })) {
        const envelope = message.envelope;
        if (envelope) {
          const fromAddr = envelope.from?.[0];
          const toAddr = envelope.to?.[0];
          
          emails.push({
            uid: message.uid,
            subject: envelope.subject || '',
            sender: fromAddr?.address || fromAddr?.name || '',
            recipient: toAddr?.address || toAddr?.name || '',
            date: envelope.date ? envelope.date.toISOString() : new Date().toISOString()
          });
        }
      }
      
      // Sort emails by date based on sortOrder
      emails.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });
      
      console.log(`[EmailList] Returning ${emails.length} emails, page ${validPage}/${totalPages}`);
      
      res.json({
        success: true,
        emails,
        pagination: {
          page: validPage,
          pageSize,
          totalCount,
          totalPages
        }
      });
    } finally {
      await connection.mailboxClose();
    }
  } catch (error) {
    console.error('[EmailList] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/emails/search - Search emails by subject pattern with count
 * Supports sorting by date with sortOrder param ('asc' or 'desc')
 * Requirements: 6.3
 */
app.post('/api/emails/search', async (req, res) => {
  const { sessionId, folder = 'INBOX', subjectPattern, page = 1, pageSize = 20, sortOrder = 'desc' } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!subjectPattern) {
    return res.status(400).json({ error: 'Subject pattern is required' });
  }

  try {
    console.log(`[EmailSearch] Searching in ${folder} for subject: ${subjectPattern}, sortOrder: ${sortOrder}`);
    
    const connection = session.connection;
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });
    
    try {
      // Search by subject
      const searchCriteria = { subject: subjectPattern };
      const matchingUids = await connection.search(searchCriteria, { uid: true });
      
      if (matchingUids === false || matchingUids.length === 0) {
        return res.json({
          success: true,
          emails: [],
          count: 0,
          pagination: {
            page,
            pageSize,
            totalCount: 0,
            totalPages: 0
          }
        });
      }
      
      // Sort UIDs based on sortOrder
      const sortedUids = sortOrder === 'asc'
        ? [...matchingUids].sort((a, b) => a - b)
        : [...matchingUids].sort((a, b) => b - a);
      const totalCount = sortedUids.length;
      const totalPages = Math.ceil(totalCount / pageSize);
      const validPage = Math.max(1, Math.min(page, totalPages));
      
      // Calculate slice for current page
      const startIndex = (validPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, sortedUids.length);
      const pageUids = sortedUids.slice(startIndex, endIndex);
      
      // Fetch only envelope data (no body/source)
      const emails: EmailMetadata[] = [];
      const range = pageUids.join(',');
      
      for await (const message of connection.fetch(range, {
        uid: true,
        envelope: true
      }, { uid: true })) {
        const envelope = message.envelope;
        if (envelope) {
          const fromAddr = envelope.from?.[0];
          const toAddr = envelope.to?.[0];
          
          emails.push({
            uid: message.uid,
            subject: envelope.subject || '',
            sender: fromAddr?.address || fromAddr?.name || '',
            recipient: toAddr?.address || toAddr?.name || '',
            date: envelope.date ? envelope.date.toISOString() : new Date().toISOString()
          });
        }
      }
      
      // Sort emails by date based on sortOrder
      emails.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });
      
      console.log(`[EmailSearch] Found ${totalCount} matching emails, returning page ${validPage}`);
      
      res.json({
        success: true,
        emails,
        count: totalCount,
        pagination: {
          page: validPage,
          pageSize,
          totalCount,
          totalPages
        }
      });
    } finally {
      await connection.mailboxClose();
    }
  } catch (error) {
    console.error('[EmailSearch] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/emails/batch-delete - Delete multiple emails by UID
 * Moves emails to Trash folder
 * Requirements: 6.5
 */
app.post('/api/emails/batch-delete', async (req, res) => {
  const { sessionId, folder = 'INBOX', uids } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!uids || !Array.isArray(uids) || uids.length === 0) {
    return res.status(400).json({ error: 'UIDs array is required' });
  }

  try {
    console.log(`[BatchDelete] Deleting ${uids.length} emails from ${folder}`);
    
    const connection = session.connection;
    
    // Get trash folder for this provider
    const deleter = new EmailDeleter();
    const trashFolder = await deleter.getTrashFolderName(connection);
    console.log(`[BatchDelete] Provider: ${session.provider}, Trash folder: ${trashFolder}`);
    
    if (!trashFolder) {
      return res.status(500).json({ error: 'Could not find Trash folder' });
    }
    
    // Open the mailbox in write mode
    await connection.mailboxOpen(folder, { readOnly: false });
    
    let deleted = 0;
    let errors = 0;
    
    try {
      // Process in batches of 50 to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        const range = batch.join(',');
        
        try {
          // Always use messageMove to Trash (safer than messageDelete)
          await connection.messageMove(range, trashFolder, { uid: true });
          console.log(`[BatchDelete] Moved ${batch.length} emails to ${trashFolder}`);
          deleted += batch.length;
        } catch (error) {
          console.error(`[BatchDelete] Error deleting batch: ${error instanceof Error ? error.message : 'Unknown'}`);
          errors += batch.length;
        }
      }
    } finally {
      await connection.mailboxClose();
    }
    
    console.log(`[BatchDelete] Deleted ${deleted} emails, ${errors} errors`);
    
    res.json({
      success: true,
      deleted,
      errors,
      message: `成功删除 ${deleted} 封邮件${errors > 0 ? `，${errors} 封失败` : ''}`
    });
  } catch (error) {
    console.error('[BatchDelete] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================
// Folder Management API Endpoints
// ============================================

/**
 * POST /api/folders/create - Create a new folder
 */
app.post('/api/folders/create', async (req, res) => {
  const { sessionId, folderName } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!folderName || typeof folderName !== 'string' || folderName.trim() === '') {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    const connection = session.connection;
    const cleanName = folderName.trim();
    
    console.log(`[FolderCreate] Creating folder: ${cleanName}`);
    
    await connection.mailboxCreate(cleanName);
    
    // Refresh folder list
    const folders = await connection.list();
    const folderPaths = folders.map((f: { path: string }) => f.path);
    
    console.log(`[FolderCreate] Folder created successfully`);
    
    res.json({
      success: true,
      message: `文件夹 "${cleanName}" 创建成功`,
      folders: folderPaths
    });
  } catch (error) {
    console.error('[FolderCreate] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('ALREADYEXISTS') || message.includes('already exists')) {
      res.status(400).json({ error: '文件夹已存在' });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

/**
 * POST /api/folders/delete - Delete a folder
 */
app.post('/api/folders/delete', async (req, res) => {
  const { sessionId, folderName } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!folderName || typeof folderName !== 'string') {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  // Prevent deletion of system folders
  const protectedFolders = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Spam', 'Junk', 'Bulk', 
    '[Gmail]', '[Gmail]/All Mail', '[Gmail]/Drafts', '[Gmail]/Sent Mail', '[Gmail]/Spam', '[Gmail]/Starred', '[Gmail]/Trash'];
  
  if (protectedFolders.some(f => folderName.toLowerCase() === f.toLowerCase())) {
    return res.status(400).json({ error: '无法删除系统文件夹' });
  }

  try {
    const connection = session.connection;
    
    console.log(`[FolderDelete] Deleting folder: ${folderName}`);
    
    await connection.mailboxDelete(folderName);
    
    // Refresh folder list
    const folders = await connection.list();
    const folderPaths = folders.map((f: { path: string }) => f.path);
    
    console.log(`[FolderDelete] Folder deleted successfully`);
    
    res.json({
      success: true,
      message: `文件夹 "${folderName}" 删除成功`,
      folders: folderPaths
    });
  } catch (error) {
    console.error('[FolderDelete] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('NONEXISTENT') || message.includes('not exist')) {
      res.status(400).json({ error: '文件夹不存在' });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

/**
 * POST /api/folders/rename - Rename a folder
 */
app.post('/api/folders/rename', async (req, res) => {
  const { sessionId, oldName, newName } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!oldName || !newName || typeof oldName !== 'string' || typeof newName !== 'string') {
    return res.status(400).json({ error: 'Old and new folder names are required' });
  }

  // Prevent renaming of system folders
  const protectedFolders = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Spam', 'Junk', 'Bulk',
    '[Gmail]', '[Gmail]/All Mail', '[Gmail]/Drafts', '[Gmail]/Sent Mail', '[Gmail]/Spam', '[Gmail]/Starred', '[Gmail]/Trash'];
  
  if (protectedFolders.some(f => oldName.toLowerCase() === f.toLowerCase())) {
    return res.status(400).json({ error: '无法重命名系统文件夹' });
  }

  try {
    const connection = session.connection;
    const cleanNewName = newName.trim();
    
    console.log(`[FolderRename] Renaming folder: ${oldName} -> ${cleanNewName}`);
    
    await connection.mailboxRename(oldName, cleanNewName);
    
    // Refresh folder list
    const folders = await connection.list();
    const folderPaths = folders.map((f: { path: string }) => f.path);
    
    console.log(`[FolderRename] Folder renamed successfully`);
    
    res.json({
      success: true,
      message: `文件夹已重命名为 "${cleanNewName}"`,
      folders: folderPaths
    });
  } catch (error) {
    console.error('[FolderRename] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/emails/move - Move emails to a different folder
 */
app.post('/api/emails/move', async (req, res) => {
  const { sessionId, sourceFolder = 'INBOX', targetFolder, uids } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!targetFolder || typeof targetFolder !== 'string') {
    return res.status(400).json({ error: 'Target folder is required' });
  }

  if (!uids || !Array.isArray(uids) || uids.length === 0) {
    return res.status(400).json({ error: 'UIDs array is required' });
  }

  try {
    console.log(`[EmailMove] Moving ${uids.length} emails from ${sourceFolder} to ${targetFolder}`);
    
    const connection = session.connection;
    
    // Open source mailbox in write mode
    await connection.mailboxOpen(sourceFolder, { readOnly: false });
    
    let moved = 0;
    let errors = 0;
    
    try {
      // Process in batches of 50 to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        const range = batch.join(',');
        
        try {
          await connection.messageMove(range, targetFolder, { uid: true });
          moved += batch.length;
          console.log(`[EmailMove] Moved batch of ${batch.length} emails`);
        } catch (error) {
          console.error(`[EmailMove] Error moving batch: ${error instanceof Error ? error.message : 'Unknown'}`);
          errors += batch.length;
        }
      }
    } finally {
      await connection.mailboxClose();
    }
    
    console.log(`[EmailMove] Moved ${moved} emails, ${errors} errors`);
    
    res.json({
      success: true,
      moved,
      errors,
      message: `成功移动 ${moved} 封邮件${errors > 0 ? `，${errors} 封失败` : ''}`
    });
  } catch (error) {
    console.error('[EmailMove] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/emails/content - Get email content by UID
 * Returns the full email body content
 */
app.post('/api/emails/content', async (req, res) => {
  const { sessionId, folder = 'INBOX', uid } = req.body;
  const session = await ensureSessionConnected(sessionId);
  
  if (!session) {
    return res.status(400).json({ error: 'Not connected' });
  }

  if (!uid) {
    return res.status(400).json({ error: 'Email UID is required' });
  }

  try {
    console.log(`[EmailContent] Fetching email ${uid} from ${folder}`);
    
    const connection = session.connection;
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });
    
    try {
      // Fetch the email with full body
      let emailContent = null;
      
      for await (const message of connection.fetch(String(uid), {
        uid: true,
        envelope: true,
        source: true
      }, { uid: true })) {
        if (message.source) {
          const rawSource = message.source;
          
          // Parse the email to extract body
          const parser = new EmailParser();
          const parsed = await parser.parse(rawSource, message.uid);
          
          // Prefer HTML content if available, otherwise use text
          const bodyContent = parsed.htmlContent || parsed.textContent || '';
          const isHtml = !!parsed.htmlContent;
          
          // For raw content, use text version or strip HTML
          const rawContent = parsed.textContent || (isHtml ? parser.stripHtml(bodyContent) : bodyContent);
          
          emailContent = {
            uid: message.uid,
            subject: message.envelope?.subject || parsed.subject || '',
            from: message.envelope?.from?.[0]?.address || parsed.from || '',
            to: message.envelope?.to?.[0]?.address || '',
            date: message.envelope?.date?.toISOString() || parsed.date?.toISOString() || '',
            content: bodyContent,
            rawContent: rawContent,
            isHtml
          };
        }
      }
      
      if (!emailContent) {
        return res.status(404).json({ error: 'Email not found' });
      }
      
      console.log(`[EmailContent] Returning email content, isHtml: ${emailContent.isHtml}`);
      
      res.json({
        success: true,
        ...emailContent
      });
    } finally {
      await connection.mailboxClose();
    }
  } catch (error) {
    console.error('[EmailContent] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ============================================
// User Data Export/Import API Endpoints
// ============================================

// GET /api/user/export - Export all user data (mailboxes + patterns)
app.get('/api/user/export', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  
  try {
    const mailboxes = await getMailboxes(userId);
    const patterns = await getPatterns(userId);
    
    // Decrypt passwords for export
    const exportMailboxes = mailboxes.map(m => ({
      email: m.email,
      password: decryptPassword(m.encryptedPassword),
      provider: m.provider || 'yahoo',
      addedAt: m.addedAt,
      lastUsed: m.lastUsed,
    }));
    
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      mailboxes: exportMailboxes,
      patterns: patterns.map(p => ({
        patternName: p.patternName,
        subjectPattern: p.subjectPattern,
        regexPattern: p.regexPattern,
        regexFlags: p.regexFlags,
        tags: p.tags,
        createdAt: p.createdAt,
        lastUsed: p.lastUsed,
      })),
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=user-data-${new Date().toISOString().slice(0,10)}.json`);
    res.json(exportData);
  } catch (error) {
    console.error('[Export] Error:', error);
    res.status(500).json({ error: 'Failed to export user data' });
  }
});

// POST /api/user/import - Import user data (mailboxes + patterns)
app.post('/api/user/import', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data, options } = req.body;
  
  if (!data) {
    return res.status(400).json({ error: 'No data provided' });
  }
  
  const mergeMode = options?.merge ?? true; // Default: merge with existing
  const importMailboxes = options?.importMailboxes ?? true;
  const importPatterns = options?.importPatterns ?? true;
  
  try {
    let mailboxesImported = 0;
    let patternsImported = 0;
    let mailboxesSkipped = 0;
    let patternsSkipped = 0;
    
    // Import mailboxes
    if (importMailboxes && data.mailboxes && Array.isArray(data.mailboxes)) {
      const existingMailboxes = await getMailboxes(userId);
      const existingEmails = new Set(existingMailboxes.map(m => m.email.toLowerCase()));
      
      for (const mailbox of data.mailboxes) {
        if (!mailbox.email || !mailbox.password) continue;
        
        // Skip if already exists (in merge mode)
        if (mergeMode && existingEmails.has(mailbox.email.toLowerCase())) {
          mailboxesSkipped++;
          continue;
        }
        
        try {
          await saveMailbox(userId, {
            email: mailbox.email,
            password: mailbox.password,
            provider: mailbox.provider || 'yahoo',
          });
          mailboxesImported++;
        } catch (e) {
          console.warn(`[Import] Failed to import mailbox ${mailbox.email}:`, e);
          mailboxesSkipped++;
        }
      }
    }
    
    // Import patterns
    if (importPatterns && data.patterns && Array.isArray(data.patterns)) {
      const existingPatterns = await getPatterns(userId);
      const existingRegex = new Set(existingPatterns.map(p => `${p.subjectPattern}|${p.regexPattern}`));
      
      for (const pattern of data.patterns) {
        if (!pattern.regexPattern) continue;
        
        const key = `${pattern.subjectPattern || ''}|${pattern.regexPattern}`;
        
        // Skip if already exists (in merge mode)
        if (mergeMode && existingRegex.has(key)) {
          patternsSkipped++;
          continue;
        }
        
        try {
          await savePattern(userId, {
            patternName: pattern.patternName,
            subjectPattern: pattern.subjectPattern || '',
            regexPattern: pattern.regexPattern,
            regexFlags: pattern.regexFlags || 'g',
            tags: pattern.tags || [],
          });
          patternsImported++;
        } catch (e) {
          console.warn(`[Import] Failed to import pattern:`, e);
          patternsSkipped++;
        }
      }
    }
    
    res.json({
      success: true,
      imported: {
        mailboxes: mailboxesImported,
        patterns: patternsImported,
      },
      skipped: {
        mailboxes: mailboxesSkipped,
        patterns: patternsSkipped,
      },
    });
  } catch (error) {
    console.error('[Import] Error:', error);
    res.status(500).json({ error: 'Failed to import user data' });
  }
});

// DELETE /api/user/data - Clear all user data
app.delete('/api/user/data', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { clearMailboxes, clearPatterns } = req.body;
  
  try {
    let mailboxesCleared = 0;
    let patternsCleared = 0;
    
    if (clearMailboxes) {
      const mailboxes = await getMailboxes(userId);
      for (const mailbox of mailboxes) {
        await deleteMailbox(userId, mailbox.id);
        mailboxesCleared++;
      }
    }
    
    if (clearPatterns) {
      const patterns = await getPatterns(userId);
      for (const pattern of patterns) {
        await deletePattern(userId, pattern.id);
        patternsCleared++;
      }
    }
    
    res.json({
      success: true,
      cleared: {
        mailboxes: mailboxesCleared,
        patterns: patternsCleared,
      },
    });
  } catch (error) {
    console.error('[ClearData] Error:', error);
    res.status(500).json({ error: 'Failed to clear user data' });
  }
});

const PORT = process.env.PORT || 3000;

// Initialize default user and start server
(async () => {
  try {
    // Ensure default admin user exists
    await ensureDefaultUser();
    
    app.listen(PORT, () => {
      console.log(`Yahoo Mail Extractor Web UI running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
