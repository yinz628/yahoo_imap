/**
 * Unit tests for ErrorClassifier
 * Tests error classification and recovery strategy logic
 */

import { describe, it, expect } from 'vitest';
import { ErrorClassifier, ErrorType } from './error-classifier.js';

describe('ErrorClassifier', () => {
  const classifier = new ErrorClassifier();

  describe('classify', () => {
    describe('authentication errors', () => {
      it('should classify authentication failure', () => {
        const error = new Error('Authentication failed');
        expect(classifier.classify(error)).toBe(ErrorType.AUTHENTICATION);
      });

      it('should classify credential errors', () => {
        const error = new Error('Invalid credentials provided');
        expect(classifier.classify(error)).toBe(ErrorType.AUTHENTICATION);
      });

      it('should classify password errors', () => {
        const error = new Error('Wrong password');
        expect(classifier.classify(error)).toBe(ErrorType.AUTHENTICATION);
      });

      it('should classify login errors', () => {
        const error = new Error('Login failed');
        expect(classifier.classify(error)).toBe(ErrorType.AUTHENTICATION);
      });

      it('should classify AUTHENTICATIONFAILED errors', () => {
        const error = new Error('AUTHENTICATIONFAILED');
        expect(classifier.classify(error)).toBe(ErrorType.AUTHENTICATION);
      });
    });

    describe('rate limit errors', () => {
      it('should classify rate limit errors', () => {
        const error = new Error('Rate limit exceeded');
        expect(classifier.classify(error)).toBe(ErrorType.RATE_LIMIT);
      });

      it('should classify too many requests', () => {
        const error = new Error('Too many requests');
        expect(classifier.classify(error)).toBe(ErrorType.RATE_LIMIT);
      });

      it('should classify quota errors', () => {
        const error = new Error('Quota exceeded');
        expect(classifier.classify(error)).toBe(ErrorType.RATE_LIMIT);
      });

      it('should classify bandwidth errors', () => {
        const error = new Error('Bandwidth limit reached');
        expect(classifier.classify(error)).toBe(ErrorType.RATE_LIMIT);
      });

      it('should classify overquota errors', () => {
        const error = new Error('OVERQUOTA');
        expect(classifier.classify(error)).toBe(ErrorType.RATE_LIMIT);
      });
    });

    describe('timeout errors', () => {
      it('should classify timeout errors', () => {
        const error = new Error('Connection timeout');
        expect(classifier.classify(error)).toBe(ErrorType.TIMEOUT);
      });

      it('should classify timed out errors', () => {
        const error = new Error('Request timed out');
        expect(classifier.classify(error)).toBe(ErrorType.TIMEOUT);
      });
    });

    describe('network errors', () => {
      it('should classify network errors', () => {
        const error = new Error('Network error occurred');
        expect(classifier.classify(error)).toBe(ErrorType.NETWORK);
      });

      it('should classify connection errors', () => {
        const error = new Error('Connection refused');
        expect(classifier.classify(error)).toBe(ErrorType.NETWORK);
      });

      it('should classify ECONNREFUSED errors', () => {
        const error = new Error('ECONNREFUSED');
        expect(classifier.classify(error)).toBe(ErrorType.NETWORK);
      });

      it('should classify ENOTFOUND errors', () => {
        const error = new Error('ENOTFOUND');
        expect(classifier.classify(error)).toBe(ErrorType.NETWORK);
      });

      it('should classify socket errors', () => {
        const error = new Error('Socket error');
        expect(classifier.classify(error)).toBe(ErrorType.NETWORK);
      });
    });

    describe('server errors', () => {
      it('should classify server errors', () => {
        const error = new Error('Server error');
        expect(classifier.classify(error)).toBe(ErrorType.SERVER_ERROR);
      });

      it('should classify internal errors', () => {
        const error = new Error('Internal error');
        expect(classifier.classify(error)).toBe(ErrorType.SERVER_ERROR);
      });

      it('should classify 5xx errors', () => {
        const error = new Error('500 Internal Server Error');
        expect(classifier.classify(error)).toBe(ErrorType.SERVER_ERROR);
      });

      it('should classify unavailable errors', () => {
        const error = new Error('Service unavailable');
        expect(classifier.classify(error)).toBe(ErrorType.SERVER_ERROR);
      });
    });

    describe('unknown errors', () => {
      it('should classify unknown errors', () => {
        const error = new Error('Something went wrong');
        expect(classifier.classify(error)).toBe(ErrorType.UNKNOWN);
      });

      it('should classify empty error messages', () => {
        const error = new Error('');
        expect(classifier.classify(error)).toBe(ErrorType.UNKNOWN);
      });
    });
  });

  describe('getRecoveryStrategy', () => {
    describe('authentication errors', () => {
      it('should not retry authentication errors', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.AUTHENTICATION, 1);
        expect(strategy.shouldRetry).toBe(false);
        expect(strategy.delay).toBe(0);
        expect(strategy.maxAttempts).toBe(0);
        expect(strategy.userMessage).toContain('认证失败');
      });
    });

    describe('rate limit errors', () => {
      it('should retry with 60 second delay', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.RATE_LIMIT, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.delay).toBe(60000);
        expect(strategy.maxAttempts).toBe(3);
        expect(strategy.userMessage).toContain('速率限制');
      });
    });

    describe('network errors', () => {
      it('should retry with exponential backoff', () => {
        // Note: delay = min(2000 * 2^attempt, 30000)
        const strategy1 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 1);
        expect(strategy1.shouldRetry).toBe(true);
        expect(strategy1.delay).toBe(4000); // 2000 * 2^1 = 4000
        expect(strategy1.maxAttempts).toBe(5);

        const strategy2 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 2);
        expect(strategy2.delay).toBe(8000); // 2000 * 2^2 = 8000

        const strategy3 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 3);
        expect(strategy3.delay).toBe(16000); // 2000 * 2^3 = 16000
      });

      it('should cap delay at 30 seconds', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.NETWORK, 10);
        expect(strategy.delay).toBe(30000);
      });
    });

    describe('timeout errors', () => {
      it('should retry with exponential backoff', () => {
        // Note: delay = min(3000 * 2^attempt, 60000)
        const strategy1 = classifier.getRecoveryStrategy(ErrorType.TIMEOUT, 1);
        expect(strategy1.shouldRetry).toBe(true);
        expect(strategy1.delay).toBe(6000); // 3000 * 2^1 = 6000
        expect(strategy1.maxAttempts).toBe(3);

        const strategy2 = classifier.getRecoveryStrategy(ErrorType.TIMEOUT, 2);
        expect(strategy2.delay).toBe(12000); // 3000 * 2^2 = 12000
      });

      it('should cap delay at 60 seconds', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.TIMEOUT, 10);
        expect(strategy.delay).toBe(60000);
      });
    });

    describe('server errors', () => {
      it('should retry with fixed 5 second delay', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.SERVER_ERROR, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.delay).toBe(5000);
        expect(strategy.maxAttempts).toBe(3);
        expect(strategy.userMessage).toContain('服务器错误');
      });
    });

    describe('unknown errors', () => {
      it('should retry with fixed 3 second delay', () => {
        const strategy = classifier.getRecoveryStrategy(ErrorType.UNKNOWN, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.delay).toBe(3000);
        expect(strategy.maxAttempts).toBe(2);
        expect(strategy.userMessage).toContain('未知错误');
      });
    });
  });
});
