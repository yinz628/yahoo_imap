// CSV Exporter Tests
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CSVExporter } from './csv.js';
import type { ExtractionResult, ParsedEmail, ExtractionMatch, ExportRecord } from '../types.js';

// Arbitrary generators for property-based testing

// Generate valid email UID (positive integer)
const emailUidArb = fc.integer({ min: 1, max: 1000000 });

// Generate valid date (ensure it's not NaN)
const dateArb = fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
  .filter(d => !isNaN(d.getTime()));

// Generate safe string (no control characters that would break CSV parsing)
const safeStringArb = fc.string({ minLength: 0, maxLength: 100 })
  .map(s => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')); // Remove control chars except \t, \n, \r

// Generate email address
const emailAddressArb = fc.tuple(
  fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/),
  fc.stringMatching(/^[a-z]{2,6}$/)
).map(([user, domain]) => `${user}@${domain}.com`);

// Generate subject line
const subjectArb = safeStringArb;

// Generate named capture group key (valid identifier)
const groupKeyArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/);

// Generate extraction match
const extractionMatchArb = fc.record({
  fullMatch: safeStringArb,
  groups: fc.dictionary(groupKeyArb, safeStringArb, { minKeys: 0, maxKeys: 3 }),
  index: fc.integer({ min: 0, max: 10000 }),
});

// Generate parsed email
const parsedEmailArb = fc.record({
  uid: emailUidArb,
  date: dateArb,
  from: emailAddressArb,
  subject: subjectArb,
  textContent: safeStringArb,
  htmlContent: fc.option(safeStringArb, { nil: undefined }),
});

// Generate extraction result
const extractionResultArb = fc.record({
  email: parsedEmailArb,
  matches: fc.array(extractionMatchArb, { minLength: 0, maxLength: 5 }),
  patternName: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,20}$/),
});

// Generate array of extraction results
const extractionResultsArb = fc.array(extractionResultArb, { minLength: 0, maxLength: 10 });

describe('CSVExporter', () => {
  const exporter = new CSVExporter();

  describe('serialize', () => {
    it('should serialize empty results', () => {
      const csv = exporter.serialize([]);
      expect(csv).toBe('emailUid,emailDate,emailFrom,emailSubject,matchIndex,fullMatch');
    });

    it('should serialize results with matches', () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 1,
          date: new Date('2024-01-15T10:30:00Z'),
          from: 'test@example.com',
          subject: 'Test Subject',
          textContent: 'Test content',
        },
        matches: [{
          fullMatch: 'matched text',
          groups: { name: 'John' },
          index: 0,
        }],
        patternName: 'testPattern',
      }];

      const csv = exporter.serialize(results);
      const lines = csv.split('\n');
      
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('emailUid');
      expect(lines[0]).toContain('name');
      expect(lines[1]).toContain('1');
      expect(lines[1]).toContain('test@example.com');
    });
  });


  describe('deserialize', () => {
    it('should deserialize empty CSV', () => {
      const records = exporter.deserialize('');
      expect(records).toEqual([]);
    });

    it('should deserialize CSV with data', () => {
      const csv = 'emailUid,emailDate,emailFrom,emailSubject,matchIndex,fullMatch\n1,2024-01-15T10:30:00.000Z,test@example.com,Test Subject,0,matched';
      const records = exporter.deserialize(csv);
      
      expect(records.length).toBe(1);
      expect(records[0].emailUid).toBe(1);
      expect(records[0].emailFrom).toBe('test@example.com');
      expect(records[0].fullMatch).toBe('matched');
    });
  });

  describe('escaping', () => {
    it('should escape fields with commas', () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 1,
          date: new Date('2024-01-15'),
          from: 'test@example.com',
          subject: 'Hello, World',
          textContent: 'content',
        },
        matches: [],
        patternName: 'test',
      }];

      const csv = exporter.serialize(results);
      expect(csv).toContain('"Hello, World"');
    });

    it('should escape fields with quotes', () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 1,
          date: new Date('2024-01-15'),
          from: 'test@example.com',
          subject: 'Say "Hello"',
          textContent: 'content',
        },
        matches: [],
        patternName: 'test',
      }];

      const csv = exporter.serialize(results);
      expect(csv).toContain('"Say ""Hello"""');
    });
  });

  /**
   * **Feature: yahoo-mail-extractor, Property 8: CSV Export Validity**
   * **Validates: Requirements 4.1**
   * 
   * For any set of extraction results, the generated CSV should be 
   * parseable back to equivalent data records.
   */
  describe('Property 8: CSV Export Validity (Round-Trip)', () => {
    it('should round-trip serialize/deserialize extraction results', () => {
      fc.assert(
        fc.property(extractionResultsArb, (results) => {
          // Serialize to CSV
          const csv = exporter.serialize(results);
          
          // Deserialize back
          const records = exporter.deserialize(csv);
          
          // Calculate expected record count
          let expectedCount = 0;
          for (const result of results) {
            expectedCount += result.matches.length === 0 ? 1 : result.matches.length;
          }
          
          // Verify record count matches
          expect(records.length).toBe(expectedCount);
          
          // Verify each record has required metadata fields
          for (const record of records) {
            expect(typeof record.emailUid).toBe('number');
            expect(typeof record.emailDate).toBe('string');
            expect(typeof record.emailFrom).toBe('string');
            expect(typeof record.emailSubject).toBe('string');
            expect(typeof record.matchIndex).toBe('number');
            expect(typeof record.fullMatch).toBe('string');
          }
          
          // Verify data integrity by checking specific values
          let recordIndex = 0;
          for (const result of results) {
            const matchCount = result.matches.length === 0 ? 1 : result.matches.length;
            
            for (let i = 0; i < matchCount; i++) {
              const record = records[recordIndex];
              
              // Check email metadata
              expect(record.emailUid).toBe(result.email.uid);
              expect(record.emailDate).toBe(result.email.date.toISOString());
              expect(record.emailFrom).toBe(result.email.from);
              expect(record.emailSubject).toBe(result.email.subject);
              
              // Check match data
              if (result.matches.length > 0) {
                expect(record.matchIndex).toBe(i);
                expect(record.fullMatch).toBe(result.matches[i].fullMatch);
                
                // Check named capture groups
                for (const [key, value] of Object.entries(result.matches[i].groups)) {
                  expect(record[key]).toBe(value);
                }
              }
              
              recordIndex++;
            }
          }
        }),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: yahoo-mail-extractor, Property 9: Export Metadata Completeness**
   * **Validates: Requirements 4.4**
   * 
   * For any exported record, the output should contain all required 
   * metadata fields (uid, date, from, subject).
   */
  describe('Property 9: Export Metadata Completeness', () => {
    it('should include all required metadata fields in every exported record', () => {
      fc.assert(
        fc.property(extractionResultsArb, (results) => {
          // Serialize to CSV
          const csv = exporter.serialize(results);
          
          // Skip empty results (only headers)
          if (results.length === 0) {
            // Even empty results should have headers
            const headers = csv.split('\n')[0];
            expect(headers).toContain('emailUid');
            expect(headers).toContain('emailDate');
            expect(headers).toContain('emailFrom');
            expect(headers).toContain('emailSubject');
            return;
          }
          
          // Deserialize back
          const records = exporter.deserialize(csv);
          
          // Verify each record has all required metadata fields
          for (const record of records) {
            // Check presence of required fields
            expect(record).toHaveProperty('emailUid');
            expect(record).toHaveProperty('emailDate');
            expect(record).toHaveProperty('emailFrom');
            expect(record).toHaveProperty('emailSubject');
            
            // Check types are correct
            expect(typeof record.emailUid).toBe('number');
            expect(typeof record.emailDate).toBe('string');
            expect(typeof record.emailFrom).toBe('string');
            expect(typeof record.emailSubject).toBe('string');
            
            // Check values are not undefined or null
            expect(record.emailUid).not.toBeUndefined();
            expect(record.emailDate).not.toBeUndefined();
            expect(record.emailFrom).not.toBeUndefined();
            expect(record.emailSubject).not.toBeUndefined();
            
            // Check emailUid is a valid positive number
            expect(record.emailUid).toBeGreaterThan(0);
            
            // Check emailDate is a valid ISO date string
            expect(() => new Date(record.emailDate)).not.toThrow();
            expect(new Date(record.emailDate).toISOString()).toBe(record.emailDate);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve metadata even for emails with no matches', () => {
      fc.assert(
        fc.property(parsedEmailArb, (email) => {
          const results: ExtractionResult[] = [{
            email,
            matches: [], // No matches
            patternName: 'testPattern',
          }];
          
          const csv = exporter.serialize(results);
          const records = exporter.deserialize(csv);
          
          expect(records.length).toBe(1);
          expect(records[0].emailUid).toBe(email.uid);
          expect(records[0].emailDate).toBe(email.date.toISOString());
          expect(records[0].emailFrom).toBe(email.from);
          expect(records[0].emailSubject).toBe(email.subject);
        }),
        { numRuns: 100 }
      );
    });
  });
});
