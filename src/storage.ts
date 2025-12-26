import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const DATA_DIR = join(__dirname, '../data');
const USERS_DIR = join(DATA_DIR, 'users');

// Encryption key for mailbox passwords (in production, use environment variable)
const ENCRYPTION_KEY = crypto.scryptSync('yahoo-mail-extractor-secret', 'salt', 32);
const IV_LENGTH = 16;

// Interfaces
export type EmailProviderType = 'yahoo' | 'gmail' | 'custom';

export interface Mailbox {
  id: string;
  email: string;
  encryptedPassword: string;
  provider: EmailProviderType;
  addedAt: string;
  lastUsed?: string;
}

export interface PatternHistory {
  id: string;
  patternName?: string;        // 模式名称 - unique identifier name for the rule (optional for backward compatibility)
  subjectPattern: string;
  regexPattern: string;
  regexFlags: string;
  tags?: string[];
  createdAt: string;
  lastUsed?: string;
}

export interface MailboxesData {
  mailboxes: Mailbox[];
}

export interface PatternsData {
  patterns: PatternHistory[];
}

// Validation errors
export class StorageError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}


// Encryption/Decryption utilities for mailbox passwords
export function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function decryptPassword(encryptedPassword: string): string {
  const parts = encryptedPassword.split(':');
  if (parts.length !== 2) {
    throw new StorageError('Invalid encrypted password format', 'INVALID_ENCRYPTION');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Validation functions
export function validateMailbox(mailbox: unknown): mailbox is Mailbox {
  if (!mailbox || typeof mailbox !== 'object') return false;
  const m = mailbox as Record<string, unknown>;
  return (
    typeof m.id === 'string' && m.id.length > 0 &&
    typeof m.email === 'string' && m.email.length > 0 &&
    typeof m.encryptedPassword === 'string' && m.encryptedPassword.length > 0 &&
    typeof m.addedAt === 'string' && m.addedAt.length > 0 &&
    (m.lastUsed === undefined || typeof m.lastUsed === 'string')
  );
}

export function validatePatternHistory(pattern: unknown): pattern is PatternHistory {
  if (!pattern || typeof pattern !== 'object') return false;
  const p = pattern as Record<string, unknown>;
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.subjectPattern === 'string' &&
    typeof p.regexPattern === 'string' &&
    typeof p.regexFlags === 'string' &&
    typeof p.createdAt === 'string' && p.createdAt.length > 0 &&
    (p.lastUsed === undefined || typeof p.lastUsed === 'string') &&
    (p.tags === undefined || (Array.isArray(p.tags) && p.tags.every(t => typeof t === 'string'))) &&
    (p.patternName === undefined || typeof p.patternName === 'string')
  );
}

export function validateMailboxInput(data: unknown): { email: string; password: string } {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Invalid mailbox data: expected object');
  }
  const d = data as Record<string, unknown>;
  
  if (typeof d.email !== 'string' || d.email.trim().length === 0) {
    throw new ValidationError('Missing required field: email', 'email');
  }
  if (typeof d.password !== 'string' || d.password.length === 0) {
    throw new ValidationError('Missing required field: password', 'password');
  }
  
  return { email: d.email.trim(), password: d.password };
}

export function validatePatternInput(data: unknown): { patternName?: string; subjectPattern: string; regexPattern: string; regexFlags: string; tags?: string[] } {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Invalid pattern data: expected object');
  }
  const d = data as Record<string, unknown>;
  
  if (typeof d.subjectPattern !== 'string') {
    throw new ValidationError('Missing required field: subjectPattern', 'subjectPattern');
  }
  if (typeof d.regexPattern !== 'string' || d.regexPattern.length === 0) {
    throw new ValidationError('Missing required field: regexPattern', 'regexPattern');
  }
  
  // Validate regex pattern is valid
  try {
    new RegExp(d.regexPattern, (d.regexFlags as string) || '');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new ValidationError(`Invalid regex pattern: ${message}`, 'regexPattern');
  }
  
  // Validate tags if provided
  let tags: string[] | undefined;
  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags) || !d.tags.every(t => typeof t === 'string')) {
      throw new ValidationError('Tags must be an array of strings', 'tags');
    }
    tags = d.tags.map(t => t.trim()).filter(t => t.length > 0);
  }
  
  // Validate patternName if provided
  let patternName: string | undefined;
  if (d.patternName !== undefined) {
    if (typeof d.patternName !== 'string') {
      throw new ValidationError('Pattern name must be a string', 'patternName');
    }
    patternName = d.patternName.trim() || undefined;
  }
  
  return {
    patternName,
    subjectPattern: d.subjectPattern,
    regexPattern: d.regexPattern,
    regexFlags: typeof d.regexFlags === 'string' ? d.regexFlags : '',
    tags,
  };
}


// File system utilities
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

export async function ensureUserDir(userId: string): Promise<string> {
  const userDir = join(USERS_DIR, userId);
  await ensureDir(userDir);
  return userDir;
}

export function getUserDir(userId: string): string {
  return join(USERS_DIR, userId);
}

async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    return parsed as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    if (error instanceof SyntaxError) {
      throw new StorageError(`Invalid JSON: ${error.message}`, 'INVALID_JSON');
    }
    throw new StorageError('Failed to read data', 'READ_ERROR');
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const dir = dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Mailbox operations
export async function getMailboxes(userId: string): Promise<Mailbox[]> {
  const filePath = join(getUserDir(userId), 'mailboxes.json');
  const data = await readJsonFile<MailboxesData>(filePath, { mailboxes: [] });
  
  // Validate each mailbox
  if (!Array.isArray(data.mailboxes)) {
    throw new StorageError('Invalid mailboxes data structure', 'INVALID_DATA');
  }
  
  for (const mailbox of data.mailboxes) {
    if (!validateMailbox(mailbox)) {
      throw new StorageError('Invalid mailbox data structure', 'INVALID_DATA');
    }
  }
  
  return data.mailboxes;
}

/**
 * Detect email provider from email address
 */
function detectProvider(email: string): EmailProviderType {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return 'yahoo';
  
  if (domain.includes('yahoo') || domain.includes('ymail') || domain.includes('rocketmail')) {
    return 'yahoo';
  }
  if (domain.includes('gmail') || domain.includes('googlemail')) {
    return 'gmail';
  }
  return 'yahoo'; // Default to Yahoo for unknown domains
}

export async function saveMailbox(userId: string, input: { email: string; password: string; provider?: EmailProviderType }): Promise<Mailbox> {
  const validated = validateMailboxInput(input);
  await ensureUserDir(userId);
  
  const mailboxes = await getMailboxes(userId);
  
  // Detect provider if not specified
  const provider = input.provider || detectProvider(validated.email);
  
  const mailbox: Mailbox = {
    id: uuidv4(),
    email: validated.email,
    encryptedPassword: encryptPassword(validated.password),
    provider,
    addedAt: new Date().toISOString(),
  };
  
  mailboxes.push(mailbox);
  
  const filePath = join(getUserDir(userId), 'mailboxes.json');
  await writeJsonFile(filePath, { mailboxes });
  
  return mailbox;
}

export async function updateMailbox(userId: string, mailboxId: string, input: { email?: string; password?: string; provider?: EmailProviderType }): Promise<Mailbox> {
  const mailboxes = await getMailboxes(userId);
  const mailbox = mailboxes.find(m => m.id === mailboxId);
  
  if (!mailbox) {
    throw new StorageError(`Resource not found: ${mailboxId}`, 'NOT_FOUND');
  }
  
  // Update fields if provided
  if (input.email) {
    mailbox.email = input.email.trim();
  }
  if (input.password) {
    mailbox.encryptedPassword = encryptPassword(input.password);
  }
  if (input.provider) {
    mailbox.provider = input.provider;
  }
  
  const filePath = join(getUserDir(userId), 'mailboxes.json');
  await writeJsonFile(filePath, { mailboxes });
  
  return mailbox;
}

export async function deleteMailbox(userId: string, mailboxId: string): Promise<void> {
  const mailboxes = await getMailboxes(userId);
  const index = mailboxes.findIndex(m => m.id === mailboxId);
  
  if (index === -1) {
    throw new StorageError(`Resource not found: ${mailboxId}`, 'NOT_FOUND');
  }
  
  mailboxes.splice(index, 1);
  
  const filePath = join(getUserDir(userId), 'mailboxes.json');
  await writeJsonFile(filePath, { mailboxes });
}

export async function updateMailboxLastUsed(userId: string, mailboxId: string): Promise<void> {
  const mailboxes = await getMailboxes(userId);
  const mailbox = mailboxes.find(m => m.id === mailboxId);
  
  if (mailbox) {
    mailbox.lastUsed = new Date().toISOString();
    const filePath = join(getUserDir(userId), 'mailboxes.json');
    await writeJsonFile(filePath, { mailboxes });
  }
}


// Pattern history operations
export async function getPatterns(userId: string): Promise<PatternHistory[]> {
  const filePath = join(getUserDir(userId), 'patterns.json');
  const data = await readJsonFile<PatternsData>(filePath, { patterns: [] });
  
  // Validate each pattern
  if (!Array.isArray(data.patterns)) {
    throw new StorageError('Invalid patterns data structure', 'INVALID_DATA');
  }
  
  for (const pattern of data.patterns) {
    if (!validatePatternHistory(pattern)) {
      throw new StorageError('Invalid pattern data structure', 'INVALID_DATA');
    }
  }
  
  return data.patterns;
}

export async function savePattern(userId: string, input: { patternName?: string; subjectPattern: string; regexPattern: string; regexFlags?: string; tags?: string[] }): Promise<PatternHistory> {
  const validated = validatePatternInput(input);
  await ensureUserDir(userId);
  
  const patterns = await getPatterns(userId);
  
  const pattern: PatternHistory = {
    id: uuidv4(),
    patternName: validated.patternName,
    subjectPattern: validated.subjectPattern,
    regexPattern: validated.regexPattern,
    regexFlags: validated.regexFlags,
    tags: validated.tags,
    createdAt: new Date().toISOString(),
  };
  
  patterns.push(pattern);
  
  const filePath = join(getUserDir(userId), 'patterns.json');
  await writeJsonFile(filePath, { patterns });
  
  return pattern;
}

export async function deletePattern(userId: string, patternId: string): Promise<void> {
  const patterns = await getPatterns(userId);
  const index = patterns.findIndex(p => p.id === patternId);
  
  if (index === -1) {
    throw new StorageError(`Resource not found: ${patternId}`, 'NOT_FOUND');
  }
  
  patterns.splice(index, 1);
  
  const filePath = join(getUserDir(userId), 'patterns.json');
  await writeJsonFile(filePath, { patterns });
}

export async function updatePattern(userId: string, patternId: string, input: { patternName?: string; subjectPattern: string; regexPattern: string; regexFlags?: string; tags?: string[] }): Promise<PatternHistory> {
  const validated = validatePatternInput(input);
  const patterns = await getPatterns(userId);
  const pattern = patterns.find(p => p.id === patternId);
  
  if (!pattern) {
    throw new StorageError(`Resource not found: ${patternId}`, 'NOT_FOUND');
  }
  
  pattern.patternName = validated.patternName;
  pattern.subjectPattern = validated.subjectPattern;
  pattern.regexPattern = validated.regexPattern;
  pattern.regexFlags = validated.regexFlags;
  pattern.tags = validated.tags;
  
  const filePath = join(getUserDir(userId), 'patterns.json');
  await writeJsonFile(filePath, { patterns });
  
  return pattern;
}

export async function updatePatternLastUsed(userId: string, patternId: string): Promise<PatternHistory> {
  const patterns = await getPatterns(userId);
  const pattern = patterns.find(p => p.id === patternId);
  
  if (!pattern) {
    throw new StorageError(`Resource not found: ${patternId}`, 'NOT_FOUND');
  }
  
  pattern.lastUsed = new Date().toISOString();
  const filePath = join(getUserDir(userId), 'patterns.json');
  await writeJsonFile(filePath, { patterns });
  
  return pattern;
}

// Utility to check if user directory exists
export async function userDirExists(userId: string): Promise<boolean> {
  try {
    await fs.access(getUserDir(userId));
    return true;
  } catch {
    return false;
  }
}

// Serialization helpers for round-trip testing
export function serializeMailbox(mailbox: Mailbox): string {
  return JSON.stringify(mailbox);
}

export function deserializeMailbox(json: string): Mailbox {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new ValidationError(`Invalid JSON: ${message}`);
  }
  
  if (!validateMailbox(parsed)) {
    throw new ValidationError('Invalid mailbox data structure');
  }
  
  return parsed;
}

export function serializePattern(pattern: PatternHistory): string {
  return JSON.stringify(pattern);
}

export function deserializePattern(json: string): PatternHistory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new ValidationError(`Invalid JSON: ${message}`);
  }
  
  if (!validatePatternHistory(parsed)) {
    throw new ValidationError('Invalid pattern data structure');
  }
  
  return parsed;
}

// Clear all user data (for testing purposes)
export async function clearUserData(userId: string): Promise<void> {
  const userDir = getUserDir(userId);
  try {
    await fs.rm(userDir, { recursive: true, force: true });
  } catch (e) {
    // Ignore errors if directory doesn't exist
  }
}
