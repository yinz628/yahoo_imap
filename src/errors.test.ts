// Tests for Error Handling and Progress Utilities
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ErrorCollector,
  ProgressIndicator,
  BatchProcessor,
  processEmailsWithResilience,
} from './errors.js';
import type { ProcessingError, ParsedEmail, ExtractionResult } from './types.js';

describe('ErrorCollector', () => {
  let collector: ErrorCollector;

  beforeEach(() => {
    collector = new ErrorCollector();
  });

  it('should start with no errors', () => {
    expect(collector.count).toBe(0);
    expect(collector.hasErrors()).toBe(false);
    expect(collector.errors).toEqual([]);
  });

  it('should add and retrieve errors', () => {
    const error: ProcessingError = {
      emailUid: 123,
      stage: 'parse',
      error: new Error('Parse failed'),
      timestamp: new Date(),
    };

    collector.add(error);

    expect(collector.count).toBe(1);
    expect(collector.hasErrors()).toBe(true);
    expect(collector.errors[0]).toEqual(error);
  });

  it('should add errors using addError helper', () => {
    collector.addError(456, 'fetch', new Error('Fetch failed'));

    expect(collector.count).toBe(1);
    expect(collector.errors[0].emailUid).toBe(456);
    expect(collector.errors[0].stage).toBe('fetch');
  });

  it('should get summary by stage', () => {
    collector.addError(1, 'fetch', new Error('Error 1'));
    collector.addError(2, 'parse', new Error('Error 2'));
    collector.addError(3, 'fetch', new Error('Error 3'));
    collector.addError(4, 'extract', new Error('Error 4'));

    const summary = collector.getSummary();

    expect(summary.total).toBe(4);
    expect(summary.byStage).toEqual({
      fetch: 2,
      parse: 1,
      extract: 1,
    });
  });

  it('should filter errors by stage', () => {
    collector.addError(1, 'fetch', new Error('Error 1'));
    collector.addError(2, 'parse', new Error('Error 2'));
    collector.addError(3, 'fetch', new Error('Error 3'));

    const fetchErrors = collector.getByStage('fetch');

    expect(fetchErrors.length).toBe(2);
    expect(fetchErrors.every(e => e.stage === 'fetch')).toBe(true);
  });

  it('should clear errors', () => {
    collector.addError(1, 'fetch', new Error('Error'));
    collector.clear();

    expect(collector.count).toBe(0);
    expect(collector.hasErrors()).toBe(false);
  });

  it('should format summary correctly', () => {
    collector.addError(1, 'fetch', new Error('Error 1'));
    collector.addError(2, 'parse', new Error('Error 2'));

    const formatted = collector.formatSummary();

    expect(formatted).toContain('Total errors: 2');
    expect(formatted).toContain('fetch: 1');
    expect(formatted).toContain('parse: 1');
  });

  it('should return "No errors" message when empty', () => {
    expect(collector.formatSummary()).toBe('No errors occurred.');
  });
});

describe('ProgressIndicator', () => {
  it('should track progress correctly', () => {
    const progress = new ProgressIndicator(10);

    expect(progress.getProgress().current).toBe(0);
    expect(progress.getProgress().total).toBe(10);
    expect(progress.getProgress().percentage).toBe(0);

    progress.increment();
    expect(progress.getProgress().current).toBe(1);
    expect(progress.getProgress().percentage).toBe(10);

    progress.setCurrent(5);
    expect(progress.getProgress().current).toBe(5);
    expect(progress.getProgress().percentage).toBe(50);
  });

  it('should format progress string', () => {
    const progress = new ProgressIndicator(100);
    progress.setCurrent(25);

    const formatted = progress.format();
    expect(formatted).toBe('25/100 (25.0%)');
  });

  it('should detect completion', () => {
    const progress = new ProgressIndicator(3);

    expect(progress.isComplete()).toBe(false);
    progress.increment();
    progress.increment();
    expect(progress.isComplete()).toBe(false);
    progress.increment();
    expect(progress.isComplete()).toBe(true);
  });

  it('should call progress callback', () => {
    const progressUpdates: number[] = [];
    const progress = new ProgressIndicator(5, (info) => {
      progressUpdates.push(info.current);
    });

    progress.increment();
    progress.increment();
    progress.increment();

    expect(progressUpdates).toEqual([1, 2, 3]);
  });

  it('should allow updating total', () => {
    const progress = new ProgressIndicator(10);
    progress.setCurrent(5);
    expect(progress.getProgress().percentage).toBe(50);

    progress.setTotal(20);
    expect(progress.getProgress().percentage).toBe(25);
  });
});


describe('BatchProcessor', () => {
  it('should process items successfully', async () => {
    const processor = new BatchProcessor(3);

    const result1 = await processor.processEmail(1, 'extract', () => 'result1');
    const result2 = await processor.processEmail(2, 'extract', () => 'result2');
    const result3 = await processor.processEmail(3, 'extract', () => 'result3');

    expect(result1).toBe('result1');
    expect(result2).toBe('result2');
    expect(result3).toBe('result3');

    const summary = processor.getSummary();
    expect(summary.totalProcessed).toBe(3);
    expect(summary.successfulExtractions).toBe(3);
    expect(summary.failures).toBe(0);
  });

  it('should handle failures gracefully', async () => {
    const processor = new BatchProcessor(3);

    const result1 = await processor.processEmail(1, 'extract', () => 'success');
    const result2 = await processor.processEmail(2, 'extract', () => {
      throw new Error('Processing failed');
    });
    const result3 = await processor.processEmail(3, 'extract', () => 'success');

    expect(result1).toBe('success');
    expect(result2).toBeNull();
    expect(result3).toBe('success');

    const summary = processor.getSummary();
    expect(summary.totalProcessed).toBe(3);
    expect(summary.successfulExtractions).toBe(2);
    expect(summary.failures).toBe(1);
  });

  it('should collect errors with correct details', async () => {
    const processor = new BatchProcessor(2);

    await processor.processEmail(123, 'parse', () => {
      throw new Error('Parse error');
    });
    await processor.processEmail(456, 'fetch', () => {
      throw new Error('Fetch error');
    });

    const errors = processor.getErrorCollector().errors;
    expect(errors.length).toBe(2);
    expect(errors[0].emailUid).toBe(123);
    expect(errors[0].stage).toBe('parse');
    expect(errors[1].emailUid).toBe(456);
    expect(errors[1].stage).toBe('fetch');
  });

  it('should format summary correctly', async () => {
    const processor = new BatchProcessor(3);

    await processor.processEmail(1, 'extract', () => 'success');
    await processor.processEmail(2, 'extract', () => {
      throw new Error('Failed');
    });
    await processor.processEmail(3, 'extract', () => 'success');

    const formatted = processor.formatSummary();
    expect(formatted).toContain('Total processed: 3');
    expect(formatted).toContain('Successful: 2');
    expect(formatted).toContain('Failures: 1');
  });
});

describe('processEmailsWithResilience', () => {
  const createMockEmail = (uid: number, shouldFail: boolean = false): ParsedEmail => ({
    uid,
    date: new Date(),
    from: `test${uid}@example.com`,
    subject: `Test ${uid}`,
    textContent: shouldFail ? 'FAIL' : `Content ${uid}`,
  });

  const createExtractor = (failOnContent: string) => {
    return (email: ParsedEmail): ExtractionResult => {
      if (email.textContent === failOnContent) {
        throw new Error('Extraction failed');
      }
      return {
        email,
        matches: [{ fullMatch: email.textContent, groups: {}, index: 0 }],
        patternName: 'test',
      };
    };
  };

  it('should process all emails successfully when no errors', async () => {
    const emails = [
      createMockEmail(1),
      createMockEmail(2),
      createMockEmail(3),
    ];

    const { results, summary } = await processEmailsWithResilience(
      emails,
      createExtractor('NEVER_FAIL')
    );

    expect(results.length).toBe(3);
    expect(summary.successfulExtractions).toBe(3);
    expect(summary.failures).toBe(0);
  });

  it('should continue processing after failures', async () => {
    const emails = [
      createMockEmail(1),
      createMockEmail(2, true), // This one will fail
      createMockEmail(3),
    ];

    const { results, summary } = await processEmailsWithResilience(
      emails,
      createExtractor('FAIL')
    );

    expect(results.length).toBe(2);
    expect(summary.successfulExtractions).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.totalProcessed).toBe(3);
  });

  it('should track progress during processing', async () => {
    const emails = [createMockEmail(1), createMockEmail(2)];
    const progressUpdates: number[] = [];

    await processEmailsWithResilience(
      emails,
      createExtractor('NEVER_FAIL'),
      (info) => progressUpdates.push(info.current)
    );

    expect(progressUpdates).toEqual([1, 2]);
  });
});


/**
 * **Feature: yahoo-mail-extractor, Property 10: Error Resilience**
 * **Validates: Requirements 5.2**
 * 
 * For any batch of emails where some fail to process, the extractor should
 * continue processing and return results for all successful emails.
 */
describe('Property 10: Error Resilience', () => {
  // Generate a batch of emails with unique UIDs and some marked to fail
  // We use uniqueArray to ensure UIDs are unique (realistic email scenario)
  const emailBatchArbitrary = fc.integer({ min: 1, max: 50 }).chain(size => {
    // Generate unique UIDs first
    return fc.uniqueArray(fc.integer({ min: 1, max: 100000 }), { minLength: size, maxLength: size })
      .chain(uids => {
        // For each UID, generate email data and shouldFail flag
        return fc.tuple(
          ...uids.map(uid => 
            fc.record({
              email: fc.record({
                uid: fc.constant(uid),
                date: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
                from: fc.emailAddress(),
                subject: fc.string({ minLength: 0, maxLength: 100 }),
                textContent: fc.string({ minLength: 0, maxLength: 500 }),
                htmlContent: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
              }) as fc.Arbitrary<ParsedEmail>,
              shouldFail: fc.boolean(),
            })
          )
        );
      });
  });

  it('should return results for all successful emails regardless of failures', async () => {
    await fc.assert(
      fc.asyncProperty(emailBatchArbitrary, async (batch) => {
        const emails = batch.map(b => b.email);
        const failingUids = new Set(
          batch.filter(b => b.shouldFail).map(b => b.email.uid)
        );

        // Create an extractor that fails for specific UIDs
        const extractor = (email: ParsedEmail): ExtractionResult => {
          if (failingUids.has(email.uid)) {
            throw new Error(`Simulated failure for UID ${email.uid}`);
          }
          return {
            email,
            matches: [],
            patternName: 'test',
          };
        };

        const { results, summary } = await processEmailsWithResilience(emails, extractor);

        // Property: Number of successful results equals emails that didn't fail
        const expectedSuccessCount = batch.filter(b => !b.shouldFail).length;
        expect(results.length).toBe(expectedSuccessCount);

        // Property: All returned results are from non-failing emails
        const resultUids = new Set(results.map(r => r.email.uid));
        for (const uid of resultUids) {
          expect(failingUids.has(uid)).toBe(false);
        }

        // Property: Summary correctly reports totals
        expect(summary.totalProcessed).toBe(emails.length);
        expect(summary.successfulExtractions).toBe(expectedSuccessCount);
        expect(summary.failures).toBe(failingUids.size);

        // Property: All failures are recorded in errors
        expect(summary.errors.length).toBe(failingUids.size);
        for (const error of summary.errors) {
          expect(failingUids.has(error.emailUid)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Arbitrary for generating mock emails with unique UIDs
  const emailArrayArbitrary = fc.integer({ min: 1, max: 20 }).chain(size => {
    return fc.uniqueArray(fc.integer({ min: 1, max: 100000 }), { minLength: size, maxLength: size })
      .chain(uids => {
        return fc.tuple(
          ...uids.map(uid => 
            fc.record({
              uid: fc.constant(uid),
              date: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
              from: fc.emailAddress(),
              subject: fc.string({ minLength: 0, maxLength: 100 }),
              textContent: fc.string({ minLength: 0, maxLength: 500 }),
              htmlContent: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
            }) as fc.Arbitrary<ParsedEmail>
          )
        );
      });
  });

  it('should process all emails when none fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArrayArbitrary,
        async (emails) => {
          const extractor = (email: ParsedEmail): ExtractionResult => ({
            email,
            matches: [],
            patternName: 'test',
          });

          const { results, summary } = await processEmailsWithResilience(emails, extractor);

          // Property: All emails processed successfully
          expect(results.length).toBe(emails.length);
          expect(summary.successfulExtractions).toBe(emails.length);
          expect(summary.failures).toBe(0);
          expect(summary.errors.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle all emails failing gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        emailArrayArbitrary,
        async (emails) => {
          const extractor = (_email: ParsedEmail): ExtractionResult => {
            throw new Error('All fail');
          };

          const { results, summary } = await processEmailsWithResilience(emails, extractor);

          // Property: No results when all fail
          expect(results.length).toBe(0);
          expect(summary.successfulExtractions).toBe(0);
          expect(summary.failures).toBe(emails.length);
          expect(summary.errors.length).toBe(emails.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
