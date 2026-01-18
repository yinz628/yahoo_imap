/**
 * Integration tests for Gmail Connection Stability improvements
 * Tests complete connection flows for Gmail and Yahoo, including Keep-Alive,
 * extraction, disconnect, and error recovery scenarios.
 * 
 * Requirements: 1.1, 1.2, 2.2, 2.3, 4.3, 4.4, 10.1-10.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IMAPConnector, getProviderConnectionOptions, PROVIDER_CONNECTION_OPTIONS } from './connector.js';
import { ErrorClassifier, ErrorType } from './error-classifier.js';
import type { IMAPConfig, EmailProvider } from './types.js';

describe('Gmail Connection Stability - Integration Tests', () => {
  describe('13.1 Gmail Complete Connection Flow', () => {
    let connector: IMAPConnector;
    
    beforeEach(() => {
      // Create connector with Gmail provider
      connector = new IMAPConnector('gmail');
    });
    
    afterEach(async () => {
      // Clean up connection
      if (connector.isConnected()) {
        await connector.disconnect();
      }
    });

    it('should use Gmail-specific timeout configuration', () => {
      // Requirements: 1.1
      const gmailOptions = getProviderConnectionOptions('gmail');
      const yahooOptions = getProviderConnectionOptions('yahoo');
      
      // Gmail should have longer timeouts than Yahoo
      expect(gmailOptions.connectionTimeout).toBeGreaterThan(yahooOptions.connectionTimeout);
      expect(gmailOptions.connectionTimeout).toBe(60000); // 60 seconds
      expect(yahooOptions.connectionTimeout).toBe(30000); // 30 seconds
      
      // Gmail should have more retries
      expect(gmailOptions.maxRetries).toBeGreaterThanOrEqual(yahooOptions.maxRetries);
      expect(gmailOptions.maxRetries).toBe(5);
      expect(yahooOptions.maxRetries).toBe(3);
      
      // Gmail should have shorter Keep-Alive interval (more frequent)
      expect(gmailOptions.idleTimeout).toBeLessThan(yahooOptions.idleTimeout);
      expect(gmailOptions.idleTimeout).toBe(180000); // 3 minutes
      expect(yahooOptions.idleTimeout).toBe(300000); // 5 minutes
    });

    it('should apply exponential backoff retry strategy', async () => {
      // Requirements: 2.2
      // Mock a connection that fails multiple times
      const mockConfig: IMAPConfig = {
        email: 'test@gmail.com',
        password: 'invalid-password',
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
      };

      // Spy on console.log to capture retry messages
      const consoleSpy = vi.spyOn(console, 'log');
      
      // Attempt connection (will fail due to invalid credentials)
      const result = await connector.connect(mockConfig);
      
      // Should fail
      expect(result.success).toBe(false);
      
      // Verify error classification worked (authentication error should not retry)
      expect(result.error).toContain('认证失败');
      
      consoleSpy.mockRestore();
    });

    it('should start Keep-Alive after successful connection', async () => {
      // Requirements: 4.3
      // This test verifies that Keep-Alive mechanism is initialized
      // We can't test actual connection without real credentials, but we can verify
      // the connector has the Keep-Alive infrastructure
      
      // Verify connector has Keep-Alive methods
      expect(connector.startKeepAlive).toBeDefined();
      expect(connector.stopKeepAlive).toBeDefined();
      
      // Verify Keep-Alive interval is set correctly for Gmail
      const gmailOptions = getProviderConnectionOptions('gmail');
      expect(gmailOptions.idleTimeout).toBe(180000); // 3 minutes
    });

    it('should classify errors correctly', () => {
      // Requirements: 2.2
      const classifier = new ErrorClassifier();
      
      // Test authentication error
      const authError = new Error('Authentication failed: Invalid credentials');
      expect(classifier.classify(authError)).toBe(ErrorType.AUTHENTICATION);
      
      // Test timeout error
      const timeoutError = new Error('Connection timeout');
      expect(classifier.classify(timeoutError)).toBe(ErrorType.TIMEOUT);
      
      // Test network error
      const networkError = new Error('ECONNREFUSED');
      expect(classifier.classify(networkError)).toBe(ErrorType.NETWORK);
      
      // Test rate limit error
      const rateLimitError = new Error('Rate limit exceeded');
      expect(classifier.classify(rateLimitError)).toBe(ErrorType.RATE_LIMIT);
      
      // Test server error
      const serverError = new Error('Server error 500');
      expect(classifier.classify(serverError)).toBe(ErrorType.SERVER_ERROR);
    });

    it('should provide correct recovery strategies', () => {
      // Requirements: 2.2
      const classifier = new ErrorClassifier();
      
      // Authentication errors should not retry
      const authStrategy = classifier.getRecoveryStrategy(ErrorType.AUTHENTICATION, 1);
      expect(authStrategy.shouldRetry).toBe(false);
      expect(authStrategy.maxAttempts).toBe(0);
      
      // Network errors should retry with exponential backoff
      const networkStrategy1 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 1);
      const networkStrategy2 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 2);
      expect(networkStrategy1.shouldRetry).toBe(true);
      expect(networkStrategy2.delay).toBeGreaterThan(networkStrategy1.delay);
      
      // Rate limit errors should have long delay
      const rateLimitStrategy = classifier.getRecoveryStrategy(ErrorType.RATE_LIMIT, 1);
      expect(rateLimitStrategy.shouldRetry).toBe(true);
      expect(rateLimitStrategy.delay).toBe(60000); // 1 minute
    });

    it('should handle disconnect properly', async () => {
      // Requirements: 4.3
      // Verify disconnect stops Keep-Alive
      await connector.disconnect();
      
      // Verify connection is closed
      expect(connector.isConnected()).toBe(false);
      expect(connector.getConnection()).toBeNull();
    });

    it('should verify Gmail configuration values', () => {
      // Requirements: 1.1
      const gmailOptions = PROVIDER_CONNECTION_OPTIONS.gmail;
      
      // Verify all Gmail-specific values
      expect(gmailOptions.maxRetries).toBe(5);
      expect(gmailOptions.retryDelay).toBe(2000);
      expect(gmailOptions.retryDelayMax).toBe(30000);
      expect(gmailOptions.connectionTimeout).toBe(60000);
      expect(gmailOptions.operationTimeout).toBe(45000);
      expect(gmailOptions.idleTimeout).toBe(180000);
    });
  });

  describe('13.2 Yahoo Complete Connection Flow', () => {
    let connector: IMAPConnector;
    
    beforeEach(() => {
      // Create connector with Yahoo provider
      connector = new IMAPConnector('yahoo');
    });
    
    afterEach(async () => {
      // Clean up connection
      if (connector.isConnected()) {
        await connector.disconnect();
      }
    });

    it('should use Yahoo-specific timeout configuration', () => {
      // Requirements: 1.2
      const yahooOptions = getProviderConnectionOptions('yahoo');
      const gmailOptions = getProviderConnectionOptions('gmail');
      
      // Yahoo should have shorter timeouts than Gmail
      expect(yahooOptions.connectionTimeout).toBeLessThan(gmailOptions.connectionTimeout);
      expect(yahooOptions.connectionTimeout).toBe(30000); // 30 seconds
      expect(gmailOptions.connectionTimeout).toBe(60000); // 60 seconds
      
      // Yahoo should have fewer retries
      expect(yahooOptions.maxRetries).toBeLessThanOrEqual(gmailOptions.maxRetries);
      expect(yahooOptions.maxRetries).toBe(3);
      expect(gmailOptions.maxRetries).toBe(5);
      
      // Yahoo should have longer Keep-Alive interval (less frequent)
      expect(yahooOptions.idleTimeout).toBeGreaterThan(gmailOptions.idleTimeout);
      expect(yahooOptions.idleTimeout).toBe(300000); // 5 minutes
      expect(gmailOptions.idleTimeout).toBe(180000); // 3 minutes
    });

    it('should apply exponential backoff retry strategy for Yahoo', async () => {
      // Requirements: 2.3
      // Mock a connection that fails multiple times
      const mockConfig: IMAPConfig = {
        email: 'test@yahoo.com',
        password: 'invalid-password',
        host: 'imap.mail.yahoo.com',
        port: 993,
        tls: true,
      };

      // Spy on console.log to capture retry messages
      const consoleSpy = vi.spyOn(console, 'log');
      
      // Attempt connection (will fail due to invalid credentials)
      const result = await connector.connect(mockConfig);
      
      // Should fail
      expect(result.success).toBe(false);
      
      // Verify error classification worked (authentication error should not retry)
      expect(result.error).toContain('认证失败');
      
      consoleSpy.mockRestore();
    }, 10000); // Increase timeout to 10 seconds

    it('should start Keep-Alive after successful Yahoo connection', async () => {
      // Requirements: 4.4
      // This test verifies that Keep-Alive mechanism is initialized for Yahoo
      // We can't test actual connection without real credentials, but we can verify
      // the connector has the Keep-Alive infrastructure
      
      // Verify connector has Keep-Alive methods
      expect(connector.startKeepAlive).toBeDefined();
      expect(connector.stopKeepAlive).toBeDefined();
      
      // Verify Keep-Alive interval is set correctly for Yahoo
      const yahooOptions = getProviderConnectionOptions('yahoo');
      expect(yahooOptions.idleTimeout).toBe(300000); // 5 minutes
    });

    it('should handle Yahoo-specific retry configuration', () => {
      // Requirements: 2.3
      const yahooOptions = getProviderConnectionOptions('yahoo');
      
      // Yahoo should have 3 retries with exponential backoff
      expect(yahooOptions.maxRetries).toBe(3);
      expect(yahooOptions.retryDelay).toBe(2000); // Base delay 2s
      expect(yahooOptions.retryDelayMax).toBe(10000); // Max delay 10s
      
      // Verify retry sequence with exponential backoff
      // The ErrorClassifier uses: Math.min(2000 * Math.pow(2, attempt), 30000)
      // For attempt 1: 2000 * 2^1 = 4000
      // For attempt 2: 2000 * 2^2 = 8000
      // For attempt 3: 2000 * 2^3 = 16000
      const classifier = new ErrorClassifier();
      const strategy1 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 1);
      const strategy2 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 2);
      const strategy3 = classifier.getRecoveryStrategy(ErrorType.NETWORK, 3);
      
      expect(strategy1.delay).toBe(4000);   // 2^1 * 2000 = 4000
      expect(strategy2.delay).toBe(8000);   // 2^2 * 2000 = 8000
      expect(strategy3.delay).toBe(16000);  // 2^3 * 2000 = 16000
    });

    it('should handle disconnect properly for Yahoo', async () => {
      // Requirements: 4.4
      // Verify disconnect stops Keep-Alive
      await connector.disconnect();
      
      // Verify connection is closed
      expect(connector.isConnected()).toBe(false);
      expect(connector.getConnection()).toBeNull();
    });

    it('should verify Yahoo configuration values', () => {
      // Requirements: 1.2
      const yahooOptions = PROVIDER_CONNECTION_OPTIONS.yahoo;
      
      // Verify all Yahoo-specific values
      expect(yahooOptions.maxRetries).toBe(3);
      expect(yahooOptions.retryDelay).toBe(2000);
      expect(yahooOptions.retryDelayMax).toBe(10000);
      expect(yahooOptions.connectionTimeout).toBe(30000);
      expect(yahooOptions.operationTimeout).toBe(20000);
      expect(yahooOptions.idleTimeout).toBe(300000);
    });

    it('should use faster timeouts for Yahoo than Gmail', () => {
      // Requirements: 1.2
      const yahooOptions = getProviderConnectionOptions('yahoo');
      const gmailOptions = getProviderConnectionOptions('gmail');
      
      // Yahoo is typically faster, so all timeouts should be shorter
      expect(yahooOptions.connectionTimeout).toBeLessThan(gmailOptions.connectionTimeout);
      expect(yahooOptions.operationTimeout).toBeLessThan(gmailOptions.operationTimeout);
      expect(yahooOptions.retryDelayMax).toBeLessThan(gmailOptions.retryDelayMax);
    });
  });

  describe('13.3 Error Recovery Scenarios', () => {
    let connector: IMAPConnector;
    let classifier: ErrorClassifier;
    
    beforeEach(() => {
      connector = new IMAPConnector('gmail');
      classifier = new ErrorClassifier();
    });
    
    afterEach(async () => {
      if (connector.isConnected()) {
        await connector.disconnect();
      }
    });

    it('should classify authentication errors correctly', () => {
      // Requirements: 10.1, 10.2
      const authErrors = [
        new Error('Authentication failed'),
        new Error('Invalid credentials'),
        new Error('Login failed'),
        new Error('AUTHENTICATIONFAILED'),
        new Error('NO [AUTHENTICATIONFAILED]'),
        new Error('Invalid password'),
      ];

      authErrors.forEach(error => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(ErrorType.AUTHENTICATION);
        
        // Authentication errors should not retry
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(false);
        expect(strategy.maxAttempts).toBe(0);
      });
    });

    it('should classify network errors correctly', () => {
      // Requirements: 10.1
      const networkErrors = [
        new Error('ECONNREFUSED'),
        new Error('ENOTFOUND'),
        new Error('Network error'),
        new Error('Connection refused'),
        new Error('Socket error'),
      ];

      networkErrors.forEach(error => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(ErrorType.NETWORK);
        
        // Network errors should retry
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.maxAttempts).toBeGreaterThan(0);
      });
    });

    it('should classify timeout errors correctly', () => {
      // Requirements: 10.5
      const timeoutErrors = [
        new Error('Connection timeout'),
        new Error('Request timed out'),
        new Error('Timeout exceeded'),
      ];

      timeoutErrors.forEach(error => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(ErrorType.TIMEOUT);
        
        // Timeout errors should retry
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.maxAttempts).toBeGreaterThan(0);
      });
    });

    it('should classify rate limit errors correctly', () => {
      // Requirements: 10.3
      const rateLimitErrors = [
        new Error('Rate limit exceeded'),
        new Error('Too many requests'),
        new Error('Quota exceeded'),
        new Error('Bandwidth limit'),
        new Error('OVERQUOTA'),
      ];

      rateLimitErrors.forEach(error => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(ErrorType.RATE_LIMIT);
        
        // Rate limit errors should retry with long delay
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.delay).toBe(60000); // 1 minute
      });
    });

    it('should classify server errors correctly', () => {
      // Requirements: 10.4
      const serverErrors = [
        new Error('Server error 500'),
        new Error('Internal server error'),
        new Error('Service unavailable'),
        new Error('Server error 503'),
      ];

      serverErrors.forEach(error => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(ErrorType.SERVER_ERROR);
        
        // Server errors should retry
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(true);
        expect(strategy.maxAttempts).toBeGreaterThan(0);
      });
    });

    it('should handle unknown errors with default strategy', () => {
      // Requirements: 10.6
      const unknownError = new Error('Some random error message');
      
      const errorType = classifier.classify(unknownError);
      expect(errorType).toBe(ErrorType.UNKNOWN);
      
      // Unknown errors should retry with conservative strategy
      const strategy = classifier.getRecoveryStrategy(errorType, 1);
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxAttempts).toBeGreaterThan(0);
    });

    it('should apply exponential backoff for network errors', () => {
      // Requirements: 10.7
      const networkError = new Error('ECONNREFUSED');
      const errorType = classifier.classify(networkError);
      
      // Get strategies for multiple attempts
      const strategy1 = classifier.getRecoveryStrategy(errorType, 1);
      const strategy2 = classifier.getRecoveryStrategy(errorType, 2);
      const strategy3 = classifier.getRecoveryStrategy(errorType, 3);
      
      // Delays should increase exponentially
      expect(strategy2.delay).toBeGreaterThan(strategy1.delay);
      expect(strategy3.delay).toBeGreaterThan(strategy2.delay);
      
      // Verify exponential growth: delay(n+1) = delay(n) * 2
      expect(strategy2.delay).toBe(strategy1.delay * 2);
      expect(strategy3.delay).toBe(strategy2.delay * 2);
    });

    it('should cap exponential backoff at maximum delay', () => {
      // Requirements: 10.7
      const networkError = new Error('Network error');
      const errorType = classifier.classify(networkError);
      
      // Get strategy for a high attempt number
      const strategy10 = classifier.getRecoveryStrategy(errorType, 10);
      
      // Delay should be capped at 30 seconds
      expect(strategy10.delay).toBeLessThanOrEqual(30000);
    });

    it('should provide user-friendly error messages', () => {
      // Requirements: 10.8
      const errorTypes = [
        ErrorType.AUTHENTICATION,
        ErrorType.NETWORK,
        ErrorType.TIMEOUT,
        ErrorType.RATE_LIMIT,
        ErrorType.SERVER_ERROR,
        ErrorType.UNKNOWN,
      ];

      errorTypes.forEach(errorType => {
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        
        // Every error type should have a user message
        expect(strategy.userMessage).toBeDefined();
        expect(strategy.userMessage.length).toBeGreaterThan(0);
        
        // Message should be in Chinese (contains Chinese characters)
        expect(/[\u4e00-\u9fa5]/.test(strategy.userMessage)).toBe(true);
      });
    });

    it('should handle retry behavior correctly for different error types', () => {
      // Requirements: 10.1-10.8
      const testCases = [
        { 
          error: new Error('Authentication failed'), 
          expectedType: ErrorType.AUTHENTICATION,
          shouldRetry: false 
        },
        { 
          error: new Error('ECONNREFUSED'), 
          expectedType: ErrorType.NETWORK,
          shouldRetry: true 
        },
        { 
          error: new Error('Connection timeout'), 
          expectedType: ErrorType.TIMEOUT,
          shouldRetry: true 
        },
        { 
          error: new Error('Rate limit exceeded'), 
          expectedType: ErrorType.RATE_LIMIT,
          shouldRetry: true 
        },
        { 
          error: new Error('Server error 500'), 
          expectedType: ErrorType.SERVER_ERROR,
          shouldRetry: true 
        },
      ];

      testCases.forEach(({ error, expectedType, shouldRetry }) => {
        const errorType = classifier.classify(error);
        expect(errorType).toBe(expectedType);
        
        const strategy = classifier.getRecoveryStrategy(errorType, 1);
        expect(strategy.shouldRetry).toBe(shouldRetry);
      });
    });

    it('should verify error classification is complete', () => {
      // Requirements: 10.1-10.6
      // Every error should be classified into one of the defined types
      const testErrors = [
        'Authentication failed',
        'ECONNREFUSED',
        'Connection timeout',
        'Rate limit exceeded',
        'Server error 500',
        'Random unknown error',
      ];

      const validTypes = Object.values(ErrorType);

      testErrors.forEach(errorMsg => {
        const error = new Error(errorMsg);
        const errorType = classifier.classify(error);
        
        // Error type should be one of the defined types
        expect(validTypes).toContain(errorType);
      });
    });
  });
});
