// SQLite Exporter Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SQLiteExporter } from './sqlite.js';
import type { ExtractionResult, ParsedEmail, ExtractionMatch } from '../types.js';

describe('SQLiteExporter', () => {
  let exporter: SQLiteExporter;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    exporter = new SQLiteExporter();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-test-'));
    dbPath = path.join(tempDir, 'test.db');
  });

  afterEach(() => {
    // Clean up temp files
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  const createEmail = (uid: number, from: string, subject: string): ParsedEmail => ({
    uid,
    date: new Date('2024-01-15T10:30:00Z'),
    from,
    subject,
    textContent: 'Test email content',
  });

  const createMatch = (fullMatch: string, groups: Record<string, string>, index: number): ExtractionMatch => ({
    fullMatch,
    groups,
    index,
  });

  describe('export()', () => {
    it('should create database and table with correct schema', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'sender@test.com', 'Test Subject'),
          matches: [createMatch('match1', { name: 'John', amount: '100' }, 0)],
          patternName: 'test-pattern',
        },
      ];

      await exporter.export(results, { dbPath, tableName: 'extractions' });

      // Query the database to verify
      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions');
      expect(rows).toHaveLength(1);
      expect(rows[0].emailUid).toBe(1);
      expect(rows[0].emailFrom).toBe('sender@test.com');
      expect(rows[0].emailSubject).toBe('Test Subject');
      expect(rows[0].fullMatch).toBe('match1');
      expect(rows[0].name).toBe('John');
      expect(rows[0].amount).toBe('100');
    });

    it('should handle multiple matches per email', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'sender@test.com', 'Test Subject'),
          matches: [
            createMatch('match1', { value: 'first' }, 0),
            createMatch('match2', { value: 'second' }, 1),
          ],
          patternName: 'test-pattern',
        },
      ];

      await exporter.export(results, { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions ORDER BY matchIndex');
      expect(rows).toHaveLength(2);
      expect(rows[0].matchIndex).toBe(0);
      expect(rows[0].fullMatch).toBe('match1');
      expect(rows[1].matchIndex).toBe(1);
      expect(rows[1].fullMatch).toBe('match2');
    });

    it('should handle emails with no matches', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'sender@test.com', 'No Match Subject'),
          matches: [],
          patternName: 'test-pattern',
        },
      ];

      await exporter.export(results, { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions');
      expect(rows).toHaveLength(1);
      expect(rows[0].emailUid).toBe(1);
      expect(rows[0].fullMatch).toBe('');
      expect(rows[0].matchIndex).toBe(0);
    });

    it('should handle empty results', async () => {
      await exporter.export([], { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions');
      expect(rows).toHaveLength(0);
    });

    it('should use custom table name', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'sender@test.com', 'Test'),
          matches: [createMatch('match', {}, 0)],
          patternName: 'test',
        },
      ];

      await exporter.export(results, { dbPath, tableName: 'custom_table' });

      const rows = await exporter.query(dbPath, 'SELECT * FROM custom_table');
      expect(rows).toHaveLength(1);
    });

    it('should include all email metadata', async () => {
      const email = createEmail(42, 'test@example.com', 'Important Email');
      const results: ExtractionResult[] = [
        {
          email,
          matches: [createMatch('data', {}, 0)],
          patternName: 'test',
        },
      ];

      await exporter.export(results, { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions');
      expect(rows[0].emailUid).toBe(42);
      expect(rows[0].emailDate).toBe('2024-01-15T10:30:00.000Z');
      expect(rows[0].emailFrom).toBe('test@example.com');
      expect(rows[0].emailSubject).toBe('Important Email');
    });

    it('should handle multiple emails with different capture groups', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'a@test.com', 'Email 1'),
          matches: [createMatch('m1', { groupA: 'valueA' }, 0)],
          patternName: 'pattern1',
        },
        {
          email: createEmail(2, 'b@test.com', 'Email 2'),
          matches: [createMatch('m2', { groupB: 'valueB' }, 0)],
          patternName: 'pattern2',
        },
      ];

      await exporter.export(results, { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT * FROM extractions ORDER BY emailUid');
      expect(rows).toHaveLength(2);
      expect(rows[0].groupA).toBe('valueA');
      expect(rows[0].groupB).toBeNull();
      expect(rows[1].groupA).toBeNull();
      expect(rows[1].groupB).toBe('valueB');
    });
  });

  describe('query()', () => {
    it('should execute SQL queries and return results', async () => {
      const results: ExtractionResult[] = [
        {
          email: createEmail(1, 'sender@test.com', 'Test'),
          matches: [createMatch('match', { price: '99.99' }, 0)],
          patternName: 'test',
        },
      ];

      await exporter.export(results, { dbPath });

      const rows = await exporter.query(dbPath, 'SELECT price FROM extractions WHERE emailUid = 1');
      expect(rows).toHaveLength(1);
      expect(rows[0].price).toBe('99.99');
    });
  });
});
