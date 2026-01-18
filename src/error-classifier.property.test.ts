/**
 * Property-based tests for ErrorClassifier
 * Feature: gmail-connection-stability
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ErrorClassifier, ErrorType } from './error-classifier.js';

describe('ErrorClassifier Property Tests', () => {
  const classifier = new ErrorClassifier();

  describe('Property 3: Authentication Errors Do Not Retry', () => {
    /**
     * Property 3: Authentication Errors Do Not Retry
     * For any authentication error, the system should not retry
     * Validates: Requirements 2.4
     */
    it('for any authentication error, shouldRetry should be false', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('Authentication failed'),
            fc.constant('Invalid credentials'),
            fc.constant('Wrong password'),
            fc.constant('Login failed'),
            fc.constant('AUTHENTICATIONFAILED'),
            fc.constant('auth error'),
            fc.constant('credential mismatch')
          ),
          (errorMessage) => {
            const error = new Error(errorMessage);
            const errorType = classifier.classify(error);
            
            // Authentication errors should be classified correctly
            expect(errorType).toBe(ErrorType.AUTHENTICATION);
            
            // Recovery strategy should not retry
            const strategy = classifier.getRecoveryStrategy(errorType, 1);
            expect(strategy.shouldRetry).toBe(false);
            expect(strategy.delay).toBe(0);
            expect(strategy.maxAttempts).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: Error Classification Completeness', () => {
    /**
     * Property 5: Error Classification Completeness
     * For any error, it should be classified into one of the defined error types
     * Validates: Requirements 10.1-10.8
     */
    it('for any error, it should be classified into a defined error type', () => {
      fc.assert(
        fc.property(
          fc.string(),
          (errorMessage) => {
            const error = new Error(errorMessage);
            const errorType = classifier.classify(error);
            
            // Should be one of the defined error types
            const validTypes = [
              ErrorType.AUTHENTICATION,
              ErrorType.NETWORK,
              ErrorType.TIMEOUT,
              ErrorType.RATE_LIMIT,
              ErrorType.SERVER_ERROR,
              ErrorType.UNKNOWN
            ];
            
            expect(validTypes).toContain(errorType);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any classified error, a recovery strategy should be provided', () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.integer({ min: 1, max: 10 }),
          (errorMessage, attempt) => {
            const error = new Error(errorMessage);
            const errorType = classifier.classify(error);
            const strategy = classifier.getRecoveryStrategy(errorType, attempt);
            
            // Strategy should have all required fields
            expect(strategy).toHaveProperty('shouldRetry');
            expect(strategy).toHaveProperty('delay');
            expect(strategy).toHaveProperty('maxAttempts');
            expect(strategy).toHaveProperty('userMessage');
            
            // Delay should be non-negative
            expect(strategy.delay).toBeGreaterThanOrEqual(0);
            
            // Max attempts should be non-negative
            expect(strategy.maxAttempts).toBeGreaterThanOrEqual(0);
            
            // User message should not be empty
            expect(strategy.userMessage.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Rate Limit Delay', () => {
    /**
     * Property 6: Rate Limit Delay
     * For any rate limit error, retry delay should be at least 60 seconds
     * Validates: Requirements 2.5, 7.2
     */
    it('for any rate limit error, delay should be at least 60 seconds', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant('Rate limit exceeded'),
            fc.constant('Too many requests'),
            fc.constant('Quota exceeded'),
            fc.constant('Bandwidth limit'),
            fc.constant('OVERQUOTA')
          ),
          fc.integer({ min: 1, max: 10 }),
          (errorMessage, attempt) => {
            const error = new Error(errorMessage);
            const errorType = classifier.classify(error);
            
            // Should be classified as rate limit
            expect(errorType).toBe(ErrorType.RATE_LIMIT);
            
            // Delay should be at least 60 seconds (60000ms)
            const strategy = classifier.getRecoveryStrategy(errorType, attempt);
            expect(strategy.delay).toBeGreaterThanOrEqual(60000);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Additional Properties', () => {
    it('for any retryable error type, delay should be positive', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            ErrorType.NETWORK,
            ErrorType.TIMEOUT,
            ErrorType.RATE_LIMIT,
            ErrorType.SERVER_ERROR,
            ErrorType.UNKNOWN
          ),
          fc.integer({ min: 1, max: 10 }),
          (errorType, attempt) => {
            const strategy = classifier.getRecoveryStrategy(errorType, attempt);
            
            if (strategy.shouldRetry) {
              expect(strategy.delay).toBeGreaterThan(0);
              expect(strategy.maxAttempts).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any error type with exponential backoff, delay should increase with attempt number', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(ErrorType.NETWORK, ErrorType.TIMEOUT),
          fc.integer({ min: 1, max: 5 }),
          (errorType, attempt) => {
            const strategy1 = classifier.getRecoveryStrategy(errorType, attempt);
            const strategy2 = classifier.getRecoveryStrategy(errorType, attempt + 1);
            
            // Delay should increase (unless capped)
            if (strategy1.delay < 30000 && errorType === ErrorType.NETWORK) {
              expect(strategy2.delay).toBeGreaterThan(strategy1.delay);
            }
            if (strategy1.delay < 60000 && errorType === ErrorType.TIMEOUT) {
              expect(strategy2.delay).toBeGreaterThan(strategy1.delay);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any network error, delay should not exceed 30 seconds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (attempt) => {
            const strategy = classifier.getRecoveryStrategy(ErrorType.NETWORK, attempt);
            expect(strategy.delay).toBeLessThanOrEqual(30000);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any timeout error, delay should not exceed 60 seconds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          (attempt) => {
            const strategy = classifier.getRecoveryStrategy(ErrorType.TIMEOUT, attempt);
            expect(strategy.delay).toBeLessThanOrEqual(60000);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
