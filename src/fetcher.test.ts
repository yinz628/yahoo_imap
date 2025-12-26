import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterEmails, EmailFetcher } from './fetcher.js';
import type { RawEmail, FetchFilter } from './types.js';

// Generate valid dates within a reasonable range
const validDateArb = fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
  .filter(d => !isNaN(d.getTime()));

// Generate a valid email address
const emailAddressArb = fc.emailAddress();

// Generate a non-empty string for subjects
const subjectArb = fc.string({ minLength: 1, maxLength: 100 });

// Generate a RawEmail object
const rawEmailArb: fc.Arbitrary<RawEmail> = fc.record({
  uid: fc.integer({ min: 1, max: 1000000 }),
  date: validDateArb,
  from: emailAddressArb,
  subject: subjectArb,
  body: fc.string(),
  html: fc.option(fc.string(), { nil: undefined }),
});

// Generate an array of RawEmails
const rawEmailsArb = fc.array(rawEmailArb, { minLength: 0, maxLength: 20 });

// Generate a date range where dateFrom <= dateTo
const dateRangeArb = fc.tuple(validDateArb, validDateArb).map(([d1, d2]) => {
  if (d1 <= d2) {
    return { dateFrom: d1, dateTo: d2 };
  }
  return { dateFrom: d2, dateTo: d1 };
});

describe('EmailFetcher', () => {
  describe('filterEmails', () => {
    /**
     * **Feature: yahoo-mail-extractor, Property 2: Date Filter Correctness**
     * *For any* date range filter and set of emails, all returned emails should 
     * have dates within the specified range (inclusive).
     * **Validates: Requirements 2.1**
     */
    describe('Property 2: Date Filter Correctness', () => {
      it('all returned emails have dates within the specified range', () => {
        fc.assert(
          fc.property(rawEmailsArb, dateRangeArb, (emails, dateRange) => {
            const filter: FetchFilter = {
              dateFrom: dateRange.dateFrom,
              dateTo: dateRange.dateTo,
            };

            const filtered = filterEmails(emails, filter);

            // All filtered emails should have dates within range
            for (const email of filtered) {
              expect(email.date.getTime()).toBeGreaterThanOrEqual(dateRange.dateFrom.getTime());
              expect(email.date.getTime()).toBeLessThanOrEqual(dateRange.dateTo.getTime());
            }
          }),
          { numRuns: 100 }
        );
      });

      it('emails outside date range are excluded', () => {
        fc.assert(
          fc.property(rawEmailsArb, dateRangeArb, (emails, dateRange) => {
            const filter: FetchFilter = {
              dateFrom: dateRange.dateFrom,
              dateTo: dateRange.dateTo,
            };

            const filtered = filterEmails(emails, filter);
            const filteredUids = new Set(filtered.map(e => e.uid));

            // Check that excluded emails are actually outside the range
            for (const email of emails) {
              if (!filteredUids.has(email.uid)) {
                const isOutsideRange = 
                  email.date < dateRange.dateFrom || 
                  email.date > dateRange.dateTo;
                expect(isOutsideRange).toBe(true);
              }
            }
          }),
          { numRuns: 100 }
        );
      });

      it('dateFrom filter excludes emails before the date', () => {
        fc.assert(
          fc.property(rawEmailsArb, validDateArb, (emails, dateFrom) => {
            const filter: FetchFilter = { dateFrom };

            const filtered = filterEmails(emails, filter);

            for (const email of filtered) {
              expect(email.date.getTime()).toBeGreaterThanOrEqual(dateFrom.getTime());
            }
          }),
          { numRuns: 100 }
        );
      });

      it('dateTo filter excludes emails after the date', () => {
        fc.assert(
          fc.property(rawEmailsArb, validDateArb, (emails, dateTo) => {
            const filter: FetchFilter = { dateTo };

            const filtered = filterEmails(emails, filter);

            for (const email of filtered) {
              expect(email.date.getTime()).toBeLessThanOrEqual(dateTo.getTime());
            }
          }),
          { numRuns: 100 }
        );
      });
    });

    /**
     * **Feature: yahoo-mail-extractor, Property 3: Sender Filter Correctness**
     * *For any* sender filter pattern and set of emails, all returned emails should 
     * have sender addresses matching the filter pattern.
     * **Validates: Requirements 2.2**
     */
    describe('Property 3: Sender Filter Correctness', () => {
      it('all returned emails have sender addresses containing the filter string', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, senderFilter) => {
              const filter: FetchFilter = { sender: senderFilter };

              const filtered = filterEmails(emails, filter);

              // All filtered emails should have sender containing the filter (case-insensitive)
              for (const email of filtered) {
                expect(email.from.toLowerCase()).toContain(senderFilter.toLowerCase());
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('emails not matching sender filter are excluded', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, senderFilter) => {
              const filter: FetchFilter = { sender: senderFilter };

              const filtered = filterEmails(emails, filter);
              const filteredUids = new Set(filtered.map(e => e.uid));

              // Check that excluded emails don't match the filter
              for (const email of emails) {
                if (!filteredUids.has(email.uid)) {
                  expect(email.from.toLowerCase()).not.toContain(senderFilter.toLowerCase());
                }
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('sender filter is case-insensitive', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 10 }),
            (emails, baseSender) => {
              // Test with different cases
              const lowerFilter: FetchFilter = { sender: baseSender.toLowerCase() };
              const upperFilter: FetchFilter = { sender: baseSender.toUpperCase() };

              const filteredLower = filterEmails(emails, lowerFilter);
              const filteredUpper = filterEmails(emails, upperFilter);

              // Both should return the same emails
              const lowerUids = filteredLower.map(e => e.uid).sort();
              const upperUids = filteredUpper.map(e => e.uid).sort();

              expect(lowerUids).toEqual(upperUids);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * **Feature: yahoo-mail-extractor, Property 4: Subject Filter Correctness**
     * *For any* subject filter pattern and set of emails, all returned emails should 
     * have subjects matching the filter pattern.
     * **Validates: Requirements 2.3**
     */
    describe('Property 4: Subject Filter Correctness', () => {
      it('all returned emails have subjects containing the filter string', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, subjectFilter) => {
              const filter: FetchFilter = { subject: subjectFilter };

              const filtered = filterEmails(emails, filter);

              // All filtered emails should have subject containing the filter (case-insensitive)
              for (const email of filtered) {
                expect(email.subject.toLowerCase()).toContain(subjectFilter.toLowerCase());
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('emails not matching subject filter are excluded', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, subjectFilter) => {
              const filter: FetchFilter = { subject: subjectFilter };

              const filtered = filterEmails(emails, filter);
              const filteredUids = new Set(filtered.map(e => e.uid));

              // Check that excluded emails don't match the filter
              for (const email of emails) {
                if (!filteredUids.has(email.uid)) {
                  expect(email.subject.toLowerCase()).not.toContain(subjectFilter.toLowerCase());
                }
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('subject filter is case-insensitive', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 10 }),
            (emails, baseSubject) => {
              // Test with different cases
              const lowerFilter: FetchFilter = { subject: baseSubject.toLowerCase() };
              const upperFilter: FetchFilter = { subject: baseSubject.toUpperCase() };

              const filteredLower = filterEmails(emails, lowerFilter);
              const filteredUpper = filterEmails(emails, upperFilter);

              // Both should return the same emails
              const lowerUids = filteredLower.map(e => e.uid).sort();
              const upperUids = filteredUpper.map(e => e.uid).sort();

              expect(lowerUids).toEqual(upperUids);
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    /**
     * **Feature: discount-code-extraction-workflow, Property 4: Subject Filter Accuracy**
     * *For any* subject filter pattern and set of emails, all returned emails should 
     * have subjects that match the filter pattern.
     * **Validates: Requirements 2.1**
     */
    describe('Property 4: Subject Filter Accuracy (discount-code-extraction-workflow)', () => {
      it('all returned emails have subjects matching the filter pattern', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, subjectFilter) => {
              const filter: FetchFilter = { subject: subjectFilter };

              const filtered = filterEmails(emails, filter);

              // All filtered emails should have subject containing the filter (case-insensitive)
              for (const email of filtered) {
                expect(email.subject.toLowerCase()).toContain(subjectFilter.toLowerCase());
              }
              
              return true;
            }
          ),
          { numRuns: 100 }
        );
      });

      it('emails not matching subject filter are excluded', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 20 }),
            (emails, subjectFilter) => {
              const filter: FetchFilter = { subject: subjectFilter };

              const filtered = filterEmails(emails, filter);
              const filteredUids = new Set(filtered.map(e => e.uid));

              // Check that excluded emails don't match the filter
              for (const email of emails) {
                if (!filteredUids.has(email.uid)) {
                  expect(email.subject.toLowerCase()).not.toContain(subjectFilter.toLowerCase());
                }
              }
              
              return true;
            }
          ),
          { numRuns: 100 }
        );
      });

      it('subject filter is case-insensitive for discount-code-extraction-workflow', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            fc.string({ minLength: 1, maxLength: 10 }),
            (emails, baseSubject) => {
              // Test with different cases
              const lowerFilter: FetchFilter = { subject: baseSubject.toLowerCase() };
              const upperFilter: FetchFilter = { subject: baseSubject.toUpperCase() };

              const filteredLower = filterEmails(emails, lowerFilter);
              const filteredUpper = filterEmails(emails, upperFilter);

              // Both should return the same emails
              const lowerUids = filteredLower.map(e => e.uid).sort();
              const upperUids = filteredUpper.map(e => e.uid).sort();

              expect(lowerUids).toEqual(upperUids);
              
              return true;
            }
          ),
          { numRuns: 100 }
        );
      });
    });

    describe('Combined Filters', () => {
      it('multiple filters are applied conjunctively (AND)', () => {
        fc.assert(
          fc.property(
            rawEmailsArb,
            dateRangeArb,
            fc.string({ minLength: 1, maxLength: 10 }),
            fc.string({ minLength: 1, maxLength: 10 }),
            (emails, dateRange, senderFilter, subjectFilter) => {
              const filter: FetchFilter = {
                dateFrom: dateRange.dateFrom,
                dateTo: dateRange.dateTo,
                sender: senderFilter,
                subject: subjectFilter,
              };

              const filtered = filterEmails(emails, filter);

              // All filtered emails should satisfy ALL conditions
              for (const email of filtered) {
                expect(email.date.getTime()).toBeGreaterThanOrEqual(dateRange.dateFrom.getTime());
                expect(email.date.getTime()).toBeLessThanOrEqual(dateRange.dateTo.getTime());
                expect(email.from.toLowerCase()).toContain(senderFilter.toLowerCase());
                expect(email.subject.toLowerCase()).toContain(subjectFilter.toLowerCase());
              }
            }
          ),
          { numRuns: 100 }
        );
      });

      it('empty filter returns all emails', () => {
        fc.assert(
          fc.property(rawEmailsArb, (emails) => {
            const filter: FetchFilter = {};

            const filtered = filterEmails(emails, filter);

            expect(filtered.length).toBe(emails.length);
            expect(filtered.map(e => e.uid).sort()).toEqual(emails.map(e => e.uid).sort());
          }),
          { numRuns: 100 }
        );
      });
    });
  });

  describe('buildSearchCriteria', () => {
    const fetcher = new EmailFetcher();

    it('builds correct criteria for date filters', () => {
      const dateFrom = new Date('2024-01-01');
      const dateTo = new Date('2024-12-31');
      
      const criteria = fetcher.buildSearchCriteria({ dateFrom, dateTo });
      
      expect(criteria.since).toEqual(dateFrom);
      expect(criteria.before).toEqual(dateTo);
    });

    it('builds correct criteria for sender filter', () => {
      const criteria = fetcher.buildSearchCriteria({ sender: 'test@example.com' });
      
      expect(criteria.from).toBe('test@example.com');
    });

    it('builds correct criteria for subject filter', () => {
      const criteria = fetcher.buildSearchCriteria({ subject: 'Important' });
      
      expect(criteria.subject).toBe('Important');
    });

    it('returns empty object for empty filter', () => {
      const criteria = fetcher.buildSearchCriteria({});
      
      expect(Object.keys(criteria).length).toBe(0);
    });
  });

  describe('getFolder', () => {
    const fetcher = new EmailFetcher();

    it('returns specified folder', () => {
      expect(fetcher.getFolder({ folder: 'Sent' })).toBe('Sent');
    });

    it('defaults to INBOX when no folder specified', () => {
      expect(fetcher.getFolder({})).toBe('INBOX');
    });
  });
});
