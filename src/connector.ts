// IMAP Connector - Manages connection to email servers (Yahoo, Gmail, etc.)
import { ImapFlow } from 'imapflow';
import type { 
  IMAPConfig, 
  ConnectionOptions, 
  ConnectionResult, 
  EmailProvider, 
  IMAPServerSettings, 
  ProviderConnectionOptions 
} from './types.js';
import { ErrorClassifier, ErrorType } from './error-classifier.js';

// Re-export types for convenience
export type { 
  ConnectionOptions, 
  ConnectionResult, 
  EmailProvider, 
  IMAPServerSettings, 
  ProviderConnectionOptions 
};

/**
 * Error thrown when IMAP authentication fails
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when IMAP connection fails
 */
export class ConnectionError extends Error {
  public readonly retryGuidance: string;

  constructor(message: string, retryGuidance?: string) {
    super(message);
    this.name = 'ConnectionError';
    this.retryGuidance = retryGuidance || 'Please check your network connection and try again.';
  }
}

/**
 * Default Yahoo Mail IMAP settings
 */
export const YAHOO_IMAP_DEFAULTS: IMAPServerSettings = {
  host: 'imap.mail.yahoo.com',
  port: 993,
  tls: true,
};

/**
 * Default Gmail IMAP settings
 */
export const GMAIL_IMAP_DEFAULTS: IMAPServerSettings = {
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
};

/**
 * Get IMAP settings for a provider
 */
export function getIMAPSettings(provider: EmailProvider): IMAPServerSettings {
  switch (provider) {
    case 'yahoo':
      return YAHOO_IMAP_DEFAULTS;
    case 'gmail':
      return GMAIL_IMAP_DEFAULTS;
    case 'custom':
    default:
      return YAHOO_IMAP_DEFAULTS; // Default to Yahoo for backward compatibility
  }
}

/**
 * Detect email provider from email address
 */
export function detectEmailProvider(email: string): EmailProvider {
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

/**
 * Provider-specific connection configurations
 * Yahoo: Fast and stable, shorter timeouts
 * Gmail: Slower response, needs longer timeouts and more retries
 * Default: Balanced configuration for other providers
 */
export const PROVIDER_CONNECTION_OPTIONS: ProviderConnectionOptions = {
  yahoo: {
    maxRetries: 3,
    retryDelay: 2000,
    retryDelayMax: 10000,          // Max delay 10s
    connectionTimeout: 30000,      // Yahoo: 30s (usually fast)
    operationTimeout: 20000,       // Operation timeout: 20s
    idleTimeout: 300000,           // Keep-Alive interval: 5 minutes
  },
  gmail: {
    maxRetries: 5,                 // Gmail: More retries
    retryDelay: 2000,              // Base delay (will use exponential backoff)
    retryDelayMax: 30000,          // Max delay 30s (longer)
    connectionTimeout: 60000,      // Gmail: 60s (2x Yahoo)
    operationTimeout: 45000,       // Operation timeout: 45s
    idleTimeout: 180000,           // Keep-Alive interval: 3 minutes (more frequent)
  },
  default: {
    maxRetries: 3,
    retryDelay: 2000,
    retryDelayMax: 15000,          // Default: 15s
    connectionTimeout: 40000,      // Default: 40s
    operationTimeout: 30000,       // Default: 30s
    idleTimeout: 240000,           // Default: 4 minutes
  },
};

/**
 * Get connection options for a provider
 * Maps 'custom' provider to 'default' configuration
 */
export function getProviderConnectionOptions(provider: EmailProvider): Required<ConnectionOptions> {
  return provider === 'custom' ? PROVIDER_CONNECTION_OPTIONS.default : PROVIDER_CONNECTION_OPTIONS[provider];
}

const DEFAULT_CONNECTION_OPTIONS: Required<ConnectionOptions> = PROVIDER_CONNECTION_OPTIONS.default;

/**
 * IMAPConnector manages the connection to Yahoo Mail server via IMAP.
 * Handles authentication, connection lifecycle, and folder listing.
 * Enhanced with retry logic, connection health checks, and auto-reconnect.
 */
export class IMAPConnector {
  private client: ImapFlow | null = null;
  private config: IMAPConfig | null = null;
  private options: Required<ConnectionOptions>;
  private provider: EmailProvider;
  private lastActivity: number = 0;
  private reconnecting: boolean = false;
  private connectionHealthy: boolean = false;
  private errorClassifier: ErrorClassifier;
  private keepAliveTimer?: NodeJS.Timeout;
  private keepAliveInterval: number;

  constructor(provider: EmailProvider = 'yahoo', options?: Partial<ConnectionOptions>) {
    // Get default options for the provider
    const defaultOptions = getProviderConnectionOptions(provider);
    // Merge with user-provided options
    this.options = { ...defaultOptions, ...options };
    this.provider = provider;
    this.errorClassifier = new ErrorClassifier();
    // Set Keep-Alive interval from idleTimeout configuration
    this.keepAliveInterval = this.options.idleTimeout;
  }

  /**
   * Calculate retry delay using exponential backoff
   * Formula: min(baseDelay * 2^(attempt-1), maxDelay)
   * 
   * @param attempt - Current retry attempt number (1-based)
   * @returns Delay in milliseconds
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.options.retryDelay;
    const maxDelay = this.options.retryDelayMax;
    const delay = baseDelay * Math.pow(2, attempt - 1);
    return Math.min(delay, maxDelay);
  }

  /**
   * Connect to Yahoo Mail server using IMAP with retry logic.
   * 
   * @param config - IMAP configuration with credentials
   * @returns ConnectionResult with success status and connection or error
   */
  async connect(config: IMAPConfig): Promise<ConnectionResult> {
    this.config = config;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = await this.attemptConnect(config, attempt);
        if (result.success) {
          this.connectionHealthy = true;
          this.lastActivity = Date.now();
          this.startKeepAlive(); // Start keep-alive after successful connection
          return result;
        }
        lastError = new Error(result.error || 'Unknown error');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      // Classify error and get recovery strategy
      if (lastError) {
        const errorType = this.errorClassifier.classify(lastError);
        const strategy = this.errorClassifier.getRecoveryStrategy(errorType, attempt);
        
        // Don't retry if strategy says so
        if (!strategy.shouldRetry) {
          return {
            success: false,
            error: `${lastError.message}. ${strategy.userMessage}`,
          };
        }
        
        // Check if we've exceeded max attempts for this error type
        if (attempt >= strategy.maxAttempts) {
          return {
            success: false,
            error: `${lastError.message}. 已达到最大重试次数。`,
          };
        }
        
        // Wait before retry
        if (attempt < this.options.maxRetries) {
          console.log(`[IMAPConnector] ${strategy.userMessage} (尝试 ${attempt}/${strategy.maxAttempts})`);
          await this.delay(strategy.delay);
        }
      }
    }

    return {
      success: false,
      error: `连接失败: ${lastError?.message || 'Unknown error'}`,
    };
  }

  /**
   * Single connection attempt with timeout
   */
  private async attemptConnect(config: IMAPConfig, attempt: number): Promise<ConnectionResult> {
    // Clean up any existing connection
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignore cleanup errors
      }
      this.client = null;
    }

    // Create ImapFlow client with Yahoo settings
    this.client = new ImapFlow({
      host: config.host || YAHOO_IMAP_DEFAULTS.host,
      port: config.port || YAHOO_IMAP_DEFAULTS.port,
      secure: config.tls ?? YAHOO_IMAP_DEFAULTS.tls,
      auth: {
        user: config.email,
        pass: config.password,
      },
      logger: false,
      emitLogs: false,
      // Connection timeout
      greetingTimeout: this.options.connectionTimeout,
      socketTimeout: this.options.connectionTimeout,
    });

    // Set up error handler
    this.client.on('error', (err: Error) => {
      console.error(`[IMAPConnector] Connection error: ${err.message}`);
      this.connectionHealthy = false;
    });

    this.client.on('close', () => {
      console.log('[IMAPConnector] Connection closed');
      this.connectionHealthy = false;
    });

    try {
      // Attempt to connect with timeout
      const connectPromise = this.client.connect();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), this.options.connectionTimeout);
      });

      await Promise.race([connectPromise, timeoutPromise]);

      console.log(`[IMAPConnector] Connected successfully on attempt ${attempt}`);
      return {
        success: true,
        connection: this.client,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Determine error type based on error message
      if (this.isAuthenticationError(errorMessage)) {
        const authError = new AuthenticationError(
          `Authentication failed: Invalid email or app password. ${errorMessage}`
        );
        return {
          success: false,
          error: authError.message,
        };
      }

      // Network/connection error
      const connError = new ConnectionError(
        `Connection failed: ${errorMessage}`,
        'Please verify your network connection, check if Yahoo IMAP is accessible, and try again. ' +
        'Ensure you are using an App Password (not your regular Yahoo password).'
      );
      return {
        success: false,
        error: `${connError.message}. ${connError.retryGuidance}`,
      };
    }
  }

  /**
   * Check if the connection is still healthy
   */
  async checkHealth(): Promise<boolean> {
    if (!this.client || !this.connectionHealthy) {
      return false;
    }

    try {
      // Try a simple NOOP command to check connection
      await this.client.noop();
      this.lastActivity = Date.now();
      return true;
    } catch {
      this.connectionHealthy = false;
      return false;
    }
  }

  /**
   * Reconnect if the connection is unhealthy
   */
  async ensureConnected(): Promise<boolean> {
    if (this.reconnecting) {
      // Wait for ongoing reconnection
      await this.delay(1000);
      return this.connectionHealthy;
    }

    if (await this.checkHealth()) {
      return true;
    }

    if (!this.config) {
      return false;
    }

    this.reconnecting = true;
    console.log('[IMAPConnector] Connection unhealthy, attempting to reconnect...');

    try {
      const result = await this.connect(this.config);
      // Keep-Alive will be started by connect() if successful
      return result.success;
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Disconnect from the IMAP server.
   * Safe to call even if not connected.
   */
  async disconnect(): Promise<void> {
    this.stopKeepAlive(); // Stop keep-alive before disconnecting
    this.connectionHealthy = false;
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignore errors during disconnect
      } finally {
        this.client = null;
        this.config = null;
      }
    }
  }

  /**
   * Start keep-alive mechanism
   * Sends NOOP command periodically to keep connection alive
   */
  startKeepAlive(): void {
    this.stopKeepAlive(); // Clear any existing timer
    
    this.keepAliveTimer = setInterval(async () => {
      if (this.client && this.connectionHealthy) {
        try {
          await this.client.noop();
          this.lastActivity = Date.now();
          console.log('[IMAPConnector] Keep-alive NOOP sent');
        } catch (error) {
          console.error('[IMAPConnector] Keep-alive failed:', error);
          this.connectionHealthy = false;
        }
      }
    }, this.keepAliveInterval);
  }

  /**
   * Stop keep-alive mechanism
   */
  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * List all available mail folders.
   * Must be connected before calling this method.
   * 
   * @returns Array of folder names
   * @throws Error if not connected
   */
  async listFolders(): Promise<string[]> {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Ensure connection is healthy
    if (!await this.ensureConnected()) {
      throw new Error('Connection lost and reconnection failed.');
    }

    try {
      const folders: string[] = [];
      const list = await this.client.list();
      
      for (const folder of list) {
        folders.push(folder.path);
      }

      this.lastActivity = Date.now();
      return folders;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to list folders: ${errorMessage}`);
    }
  }

  /**
   * Get the current IMAP connection.
   * 
   * @returns The ImapFlow client or null if not connected
   */
  getConnection(): ImapFlow | null {
    return this.client;
  }

  /**
   * Check if currently connected.
   * 
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.client !== null && this.connectionHealthy;
  }

  /**
   * Get the time since last activity
   */
  getIdleTime(): number {
    return Date.now() - this.lastActivity;
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Determine if an error message indicates an authentication failure.
   * 
   * @param message - Error message to check
   * @returns true if this is an authentication error
   */
  private isAuthenticationError(message: string): boolean {
    const authErrorPatterns = [
      'authentication failed',
      'invalid credentials',
      'login failed',
      'auth',
      'AUTHENTICATIONFAILED',
      'NO [AUTHENTICATIONFAILED]',
      'invalid password',
      'incorrect password',
    ];

    const lowerMessage = message.toLowerCase();
    return authErrorPatterns.some(pattern => lowerMessage.includes(pattern.toLowerCase()));
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
