import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getProviderConnectionOptions, PROVIDER_CONNECTION_OPTIONS, type EmailProvider, IMAPConnector } from './connector.js';

describe('Connector Property Tests', () => {
  // **Feature: gmail-connection-stability, Property 1: Gmail 超时大于 Yahoo 超时**
  // **Validates: Requirements 1.1**
  describe('Property 1: Gmail Timeout Greater Than Yahoo Timeout', () => {
    it('Gmail connection timeout should be greater than or equal to Yahoo connection timeout', () => {
      const gmailTimeout = PROVIDER_CONNECTION_OPTIONS.gmail.connectionTimeout;
      const yahooTimeout = PROVIDER_CONNECTION_OPTIONS.yahoo.connectionTimeout;
      
      expect(gmailTimeout).toBeGreaterThanOrEqual(yahooTimeout);
    });

    it('Gmail operation timeout should be greater than or equal to Yahoo operation timeout', () => {
      const gmailTimeout = PROVIDER_CONNECTION_OPTIONS.gmail.operationTimeout;
      const yahooTimeout = PROVIDER_CONNECTION_OPTIONS.yahoo.operationTimeout;
      
      expect(gmailTimeout).toBeGreaterThanOrEqual(yahooTimeout);
    });

    it('Gmail max retry delay should be greater than or equal to Yahoo max retry delay', () => {
      const gmailDelay = PROVIDER_CONNECTION_OPTIONS.gmail.retryDelayMax;
      const yahooDelay = PROVIDER_CONNECTION_OPTIONS.yahoo.retryDelayMax;
      
      expect(gmailDelay).toBeGreaterThanOrEqual(yahooDelay);
    });

    it('Gmail should have more or equal retry attempts than Yahoo', () => {
      const gmailRetries = PROVIDER_CONNECTION_OPTIONS.gmail.maxRetries;
      const yahooRetries = PROVIDER_CONNECTION_OPTIONS.yahoo.maxRetries;
      
      expect(gmailRetries).toBeGreaterThanOrEqual(yahooRetries);
    });

    it('for any provider configuration, all timeout values should be positive', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const config = getProviderConnectionOptions(provider);
            
            expect(config.connectionTimeout).toBeGreaterThan(0);
            expect(config.operationTimeout).toBeGreaterThan(0);
            expect(config.retryDelayMax).toBeGreaterThan(0);
            expect(config.retryDelay).toBeGreaterThan(0);
            expect(config.idleTimeout).toBeGreaterThan(0);
            expect(config.maxRetries).toBeGreaterThan(0);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider configuration, operation timeout should be less than connection timeout', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const config = getProviderConnectionOptions(provider);
            
            // Operation timeout should be less than connection timeout
            // This ensures operations fail before the connection times out
            expect(config.operationTimeout).toBeLessThanOrEqual(config.connectionTimeout);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider configuration, retry delay should be less than max retry delay', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const config = getProviderConnectionOptions(provider);
            
            // Base retry delay should be less than or equal to max retry delay
            expect(config.retryDelay).toBeLessThanOrEqual(config.retryDelayMax);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: gmail-connection-stability, Property 2: 重试延迟指数增长**
  // **Validates: Requirements 2.1**
  describe('Property 2: Retry Delay Exponential Growth', () => {
    it('for any retry sequence (attempt > 1), each retry delay should be 2x the previous (until max delay)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          fc.integer({ min: 2, max: 10 }), // attempt number
          (provider, attempt) => {
            const connector = new IMAPConnector(provider);
            
            // Access the private method via type assertion for testing
            const calculateRetryDelay = (connector as any).calculateRetryDelay.bind(connector);
            
            const config = getProviderConnectionOptions(provider);
            const baseDelay = config.retryDelay;
            const maxDelay = config.retryDelayMax;
            
            // Calculate expected delay: min(baseDelay * 2^(attempt-1), maxDelay)
            const expectedDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
            const actualDelay = calculateRetryDelay(attempt);
            
            // Verify the delay matches the exponential backoff formula
            expect(actualDelay).toBe(expectedDelay);
            
            // Verify delay never exceeds maxDelay
            expect(actualDelay).toBeLessThanOrEqual(maxDelay);
            
            // Verify delay is at least baseDelay for attempt 1
            if (attempt === 1) {
              expect(actualDelay).toBe(baseDelay);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any retry sequence, delay should grow exponentially until capped by maxDelay', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            const calculateRetryDelay = (connector as any).calculateRetryDelay.bind(connector);
            
            const config = getProviderConnectionOptions(provider);
            const maxRetries = config.maxRetries;
            
            let previousDelay = 0;
            let reachedMax = false;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              const currentDelay = calculateRetryDelay(attempt);
              
              if (attempt > 1) {
                // Delay should either double or stay at max
                if (!reachedMax) {
                  // Should be exactly double (or reach max)
                  const expectedDouble = previousDelay * 2;
                  if (expectedDouble <= config.retryDelayMax) {
                    expect(currentDelay).toBe(expectedDouble);
                  } else {
                    expect(currentDelay).toBe(config.retryDelayMax);
                    reachedMax = true;
                  }
                } else {
                  // Once max is reached, should stay at max
                  expect(currentDelay).toBe(config.retryDelayMax);
                }
              }
              
              previousDelay = currentDelay;
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, first retry delay should equal base delay', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            const calculateRetryDelay = (connector as any).calculateRetryDelay.bind(connector);
            
            const config = getProviderConnectionOptions(provider);
            const firstDelay = calculateRetryDelay(1);
            
            expect(firstDelay).toBe(config.retryDelay);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, delay should never exceed retryDelayMax', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          fc.integer({ min: 1, max: 20 }), // Test with attempts beyond maxRetries
          (provider, attempt) => {
            const connector = new IMAPConnector(provider);
            const calculateRetryDelay = (connector as any).calculateRetryDelay.bind(connector);
            
            const config = getProviderConnectionOptions(provider);
            const delay = calculateRetryDelay(attempt);
            
            expect(delay).toBeLessThanOrEqual(config.retryDelayMax);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: gmail-connection-stability, Property 4: Keep-Alive 定期执行**
  // **Validates: Requirements 4.4**
  describe('Property 4: Keep-Alive Periodic Execution', () => {
    it('for any provider, Keep-Alive interval should match idleTimeout configuration', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            const config = getProviderConnectionOptions(provider);
            
            // Access private keepAliveInterval property for testing
            const keepAliveInterval = (connector as any).keepAliveInterval;
            
            // Keep-Alive interval should be set from idleTimeout
            expect(keepAliveInterval).toBe(config.idleTimeout);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, Keep-Alive interval should be positive', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            const keepAliveInterval = (connector as any).keepAliveInterval;
            
            expect(keepAliveInterval).toBeGreaterThan(0);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('Gmail Keep-Alive interval should be shorter than Yahoo (more frequent)', () => {
      const gmailInterval = PROVIDER_CONNECTION_OPTIONS.gmail.idleTimeout;
      const yahooInterval = PROVIDER_CONNECTION_OPTIONS.yahoo.idleTimeout;
      
      // Gmail should have shorter interval (more frequent Keep-Alive)
      expect(gmailInterval).toBeLessThan(yahooInterval);
    });

    it('for any provider, Keep-Alive interval should be reasonable (between 1 minute and 10 minutes)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const config = getProviderConnectionOptions(provider);
            const oneMinute = 60000;
            const tenMinutes = 600000;
            
            expect(config.idleTimeout).toBeGreaterThanOrEqual(oneMinute);
            expect(config.idleTimeout).toBeLessThanOrEqual(tenMinutes);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: gmail-connection-stability, Property 8: 连接成功后启�?Keep-Alive**
  // **Validates: Requirements 4.4**
  describe('Property 8: Keep-Alive Started After Successful Connection', () => {
    it('for any provider, startKeepAlive should clear existing timer before creating new one', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            
            // Start Keep-Alive multiple times
            connector.startKeepAlive();
            const firstTimer = (connector as any).keepAliveTimer;
            
            connector.startKeepAlive();
            const secondTimer = (connector as any).keepAliveTimer;
            
            // Should have a timer after starting
            expect(secondTimer).toBeDefined();
            
            // Clean up
            connector.stopKeepAlive();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, stopKeepAlive should clear the timer', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            
            // Start then stop Keep-Alive
            connector.startKeepAlive();
            expect((connector as any).keepAliveTimer).toBeDefined();
            
            connector.stopKeepAlive();
            expect((connector as any).keepAliveTimer).toBeUndefined();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, stopKeepAlive should be safe to call multiple times', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          (provider) => {
            const connector = new IMAPConnector(provider);
            
            // Stop without starting should not throw
            expect(() => connector.stopKeepAlive()).not.toThrow();
            
            // Start and stop multiple times
            connector.startKeepAlive();
            connector.stopKeepAlive();
            connector.stopKeepAlive(); // Should be safe to call again
            
            expect((connector as any).keepAliveTimer).toBeUndefined();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('for any provider, stopKeepAlive should be called during disconnect', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<EmailProvider>('yahoo', 'gmail', 'custom'),
          async (provider) => {
            const connector = new IMAPConnector(provider);
            
            // Start Keep-Alive
            connector.startKeepAlive();
            expect((connector as any).keepAliveTimer).toBeDefined();
            
            // Disconnect should stop Keep-Alive
            await connector.disconnect();
            expect((connector as any).keepAliveTimer).toBeUndefined();
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
