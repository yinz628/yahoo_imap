import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const SALT_ROUNDS = 10;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const DATA_DIR = join(__dirname, '../data');
const USERS_FILE = join(DATA_DIR, 'users.json');

// Interfaces
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
}

export interface UsersData {
  users: User[];
}

export interface SessionsData {
  sessions: Session[];
}

// In-memory session store (for simplicity; could be persisted)
const sessions: Map<string, Session> = new Map();

// Validation errors
export class AuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'AuthError';
  }
}


// Helper functions for file operations
async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

async function readUsersFile(): Promise<UsersData> {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!parsed || !Array.isArray(parsed.users)) {
      throw new AuthError('Invalid users data structure', 'INVALID_DATA');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { users: [] };
    }
    if (error instanceof SyntaxError) {
      throw new AuthError(`Invalid JSON: ${error.message}`, 'INVALID_JSON');
    }
    throw error;
  }
}

async function writeUsersFile(data: UsersData): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// Password hashing functions
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Token generation
export function generateToken(): string {
  return uuidv4();
}

// Validate that a string is a valid bcrypt hash
export function isValidBcryptHash(hash: string): boolean {
  // bcrypt hashes start with $2a$, $2b$, or $2y$ and are 60 characters
  return /^\$2[aby]\$\d{2}\$.{53}$/.test(hash);
}


// User validation
export function validateUser(user: unknown): user is User {
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;
  return (
    typeof u.id === 'string' &&
    typeof u.username === 'string' &&
    typeof u.passwordHash === 'string' &&
    typeof u.createdAt === 'string'
  );
}

// Session validation
export function validateSession(session: unknown): session is Session {
  if (!session || typeof session !== 'object') return false;
  const s = session as Record<string, unknown>;
  return (
    typeof s.userId === 'string' &&
    typeof s.token === 'string' &&
    typeof s.expiresAt === 'number'
  );
}

// Register a new user
export async function register(username: string, password: string): Promise<User> {
  if (!username || username.trim().length < 3) {
    throw new AuthError('Username must be at least 3 characters', 'INVALID_USERNAME');
  }
  if (!password || password.length < 6) {
    throw new AuthError('Password must be at least 6 characters', 'INVALID_PASSWORD');
  }

  const usersData = await readUsersFile();
  
  // Check username uniqueness
  const existingUser = usersData.users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );
  if (existingUser) {
    throw new AuthError('Username already taken', 'USERNAME_EXISTS');
  }

  // Hash password and create user
  const passwordHash = await hashPassword(password);
  const user: User = {
    id: uuidv4(),
    username: username.trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  usersData.users.push(user);
  await writeUsersFile(usersData);

  return user;
}


// Login user
export async function login(username: string, password: string): Promise<Session> {
  if (!username || !password) {
    throw new AuthError('Username and password required', 'MISSING_CREDENTIALS');
  }

  const usersData = await readUsersFile();
  
  // Find user by username
  const user = usersData.users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );
  if (!user) {
    throw new AuthError('Invalid username or password', 'INVALID_CREDENTIALS');
  }

  // Verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new AuthError('Invalid username or password', 'INVALID_CREDENTIALS');
  }

  // Create session
  const session: Session = {
    userId: user.id,
    token: generateToken(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };

  sessions.set(session.token, session);
  return session;
}

// Validate token and return user
export async function validateToken(token: string): Promise<User | null> {
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  // Check if session expired
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  // Get user
  const usersData = await readUsersFile();
  const user = usersData.users.find(u => u.id === session.userId);
  return user || null;
}

// Logout - invalidate session
export async function logout(token: string): Promise<void> {
  sessions.delete(token);
}

// Get user by ID (helper function)
export async function getUserById(userId: string): Promise<User | null> {
  const usersData = await readUsersFile();
  return usersData.users.find(u => u.id === userId) || null;
}

// Check if session is valid (without returning user)
export function isSessionValid(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Clear all sessions (for testing purposes)
export function clearAllSessions(): void {
  sessions.clear();
}

// Default admin user configuration
const DEFAULT_ADMIN_USER = {
  id: 'default-admin-user',
  username: 'admin',
  password: 'nature123',
};

/**
 * Ensures the default admin user exists in the system.
 * This function should be called when the server starts.
 * It will create the admin user if it doesn't exist.
 */
export async function ensureDefaultUser(): Promise<void> {
  try {
    const usersData = await readUsersFile();
    
    // Check if default admin user exists
    const adminExists = usersData.users.some(
      u => u.id === DEFAULT_ADMIN_USER.id || u.username.toLowerCase() === DEFAULT_ADMIN_USER.username.toLowerCase()
    );
    
    if (!adminExists) {
      console.log('[Auth] Creating default admin user...');
      
      // Hash the password
      const passwordHash = await hashPassword(DEFAULT_ADMIN_USER.password);
      
      // Create the default admin user
      const adminUser: User = {
        id: DEFAULT_ADMIN_USER.id,
        username: DEFAULT_ADMIN_USER.username,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      
      usersData.users.push(adminUser);
      await writeUsersFile(usersData);
      
      console.log('[Auth] Default admin user created successfully');
      console.log(`[Auth] Username: ${DEFAULT_ADMIN_USER.username}`);
    } else {
      console.log('[Auth] Default admin user already exists');
    }
  } catch (error) {
    console.error('[Auth] Error ensuring default user:', error);
  }
}
