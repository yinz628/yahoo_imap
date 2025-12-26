import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigManager, ConfigValidationError } from './config.js';
import type { ExtractorConfig, FetchFilter, ExtractionPattern, CSVExportOptions, ExcelExportOptions, DBExportOptions } from './types.js';

// Arbitraries for generating valid config components
const imapConfigArb = fc.record({
  email: fc.emailAddress(),
  host: fc.domain(),
  port: fc.integer({ min: 1, max: 65535 }),
  tls: fc.boolean(),
});

// Generate valid dates only (no NaN dates)
const validDateArb = fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
  .filter(d => !isNaN(d.getTime()));

const fetchFilterArb = fc.record({
  folder: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  dateFrom: fc.option(validDateArb, { nil: undefined }),
  dateTo: fc.option(validDateArb, { nil: undefined }),
  sender: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  subject: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

const extractionPatternArb = fc.record({
  name: fc.string({ minLength: 1 }),
  pattern: fc.string({ minLength: 1 }),
  flags: fc.option(fc.constantFrom('g', 'i', 'gi', 'm', 'gm', 'im', 'gim'), { nil: undefined }),
});

const csvExportOptionsArb: fc.Arbitrary<CSVExportOptions> = fc.record({
  outputPath: fc.string({ minLength: 1 }),
  delimiter: fc.option(fc.constantFrom(',', ';', '\t'), { nil: undefined }),
  includeHeaders: fc.option(fc.boolean(), { nil: undefined }),
});

const excelExportOptionsArb: fc.Arbitrary<ExcelExportOptions> = fc.record({
  outputPath: fc.string({ minLength: 1 }),
  sheetName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

const dbExportOptionsArb: fc.Arbitrary<DBExportOptions> = fc.record({
  dbPath: fc.string({ minLength: 1 }),
  tableName: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
});

const extractorConfigArb: fc.Arbitrary<ExtractorConfig> = fc.oneof(
  fc.record({
    imap: imapConfigArb,
    filter: fetchFilterArb,
    pattern: extractionPatternArb,
    export: fc.record({
      format: fc.constant('csv' as const),
      options: csvExportOptionsArb,
    }),
  }),
  fc.record({
    imap: imapConfigArb,
    filter: fetchFilterArb,
    pattern: extractionPatternArb,
    export: fc.record({
      format: fc.constant('excel' as const),
      options: excelExportOptionsArb,
    }),
  }),
  fc.record({
    imap: imapConfigArb,
    filter: fetchFilterArb,
    pattern: extractionPatternArb,
    export: fc.record({
      format: fc.constant('sqlite' as const),
      options: dbExportOptionsArb,
    }),
  }),
);


describe('ConfigManager', () => {
  const manager = new ConfigManager();

  /**
   * **Feature: yahoo-mail-extractor, Property 1: Configuration Round-Trip Consistency**
   * *For any* valid ExtractorConfig object, serializing it to JSON and then 
   * deserializing should produce an equivalent configuration object.
   * **Validates: Requirements 6.1, 6.2**
   */
  describe('Property 1: Configuration Round-Trip Consistency', () => {
    it('serialize then deserialize produces equivalent config', () => {
      fc.assert(
        fc.property(extractorConfigArb, (config) => {
          const serialized = manager.serialize(config);
          const deserialized = manager.deserialize(serialized);

          // Compare imap
          expect(deserialized.imap.email).toBe(config.imap.email);
          expect(deserialized.imap.host).toBe(config.imap.host);
          expect(deserialized.imap.port).toBe(config.imap.port);
          expect(deserialized.imap.tls).toBe(config.imap.tls);

          // Compare filter (dates need special handling)
          expect(deserialized.filter.folder).toBe(config.filter.folder);
          expect(deserialized.filter.sender).toBe(config.filter.sender);
          expect(deserialized.filter.subject).toBe(config.filter.subject);
          
          if (config.filter.dateFrom) {
            expect(deserialized.filter.dateFrom?.getTime()).toBe(config.filter.dateFrom.getTime());
          } else {
            expect(deserialized.filter.dateFrom).toBeUndefined();
          }
          
          if (config.filter.dateTo) {
            expect(deserialized.filter.dateTo?.getTime()).toBe(config.filter.dateTo.getTime());
          } else {
            expect(deserialized.filter.dateTo).toBeUndefined();
          }

          // Compare pattern
          expect(deserialized.pattern.name).toBe(config.pattern.name);
          expect(deserialized.pattern.pattern).toBe(config.pattern.pattern);
          expect(deserialized.pattern.flags).toBe(config.pattern.flags);

          // Compare export
          expect(deserialized.export.format).toBe(config.export.format);
          expect(deserialized.export.options).toEqual(config.export.options);
        }),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: yahoo-mail-extractor, Property 11: Config Validation Correctness**
   * *For any* invalid JSON structure, the config deserializer should throw a 
   * descriptive error rather than returning invalid data.
   * **Validates: Requirements 6.4**
   */
  describe('Property 11: Config Validation Correctness', () => {
    it('throws ConfigValidationError for invalid JSON syntax', () => {
      fc.assert(
        fc.property(
          fc.string().filter(s => {
            try { JSON.parse(s); return false; } catch { return true; }
          }),
          (invalidJson) => {
            expect(() => manager.deserialize(invalidJson)).toThrow(ConfigValidationError);
            expect(() => manager.deserialize(invalidJson)).toThrow(/Invalid JSON/);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('throws ConfigValidationError for valid JSON with invalid structure', () => {
      // Generate valid JSON that doesn't match ExtractorConfig structure
      const invalidStructureArb = fc.oneof(
        fc.constant('{}'),
        fc.constant('[]'),
        fc.constant('null'),
        fc.constant('"string"'),
        fc.constant('123'),
        fc.record({
          imap: fc.constant(null),
        }).map(o => JSON.stringify(o)),
        fc.record({
          imap: fc.record({ email: fc.constant('test@test.com') }),
        }).map(o => JSON.stringify(o)),
        fc.record({
          imap: fc.record({
            email: fc.constant('test@test.com'),
            host: fc.constant('imap.test.com'),
            port: fc.constant('not-a-number'), // Invalid: should be number
            tls: fc.constant(true),
          }),
          filter: fc.constant({}),
          pattern: fc.record({
            name: fc.constant('test'),
            pattern: fc.constant('.*'),
          }),
          export: fc.record({
            format: fc.constant('csv'),
            options: fc.constant({ outputPath: '/tmp/out.csv' }),
          }),
        }).map(o => JSON.stringify(o)),
      );

      fc.assert(
        fc.property(invalidStructureArb, (invalidJson) => {
          expect(() => manager.deserialize(invalidJson)).toThrow(ConfigValidationError);
        }),
        { numRuns: 100 }
      );
    });

    it('validate returns false for invalid configs', () => {
      const invalidConfigs = [
        null,
        undefined,
        {},
        { imap: null },
        { imap: { email: 'test@test.com' } }, // Missing other imap fields
        { imap: { email: 'test@test.com', host: 'test.com', port: 993, tls: true } }, // Missing filter
      ];

      for (const invalid of invalidConfigs) {
        expect(manager.validate(invalid)).toBe(false);
      }
    });
  });
});
