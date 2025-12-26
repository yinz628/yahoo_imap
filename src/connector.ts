// IMAP Connector - Manages connection to email servers (Yahoo, Gmail, etc.)
import { ImapFlow } from 'imapflow';
import type { IMAPConfig } from './types.js';

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
 * Result of a connection attempt
 */
export interface ConnectionResult {
  success: boolean;
  error?: string;
  connection?: ImapFlow;
}

/**
 * Supported email provider types
 */
export type EmailProvider = 'yahoo' | 'gmail' | 'custom';

/**
 * IMAP server settings for a provider
 */
export interface IMAPServerSettings {
  host: string;
  port: number;
  tls: boolean;
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
 * Connection options for retry and timeout
 */
export interface ConnectionOptions {
  maxRetries?: number;
  retryDelay?: number;
  connectionTimeout?: number;
  idleTimeout?: number;
}

const DEFAULT_CONNECTION_OPTIONS: Required<ConnectionOptions> = {
  maxRetries: 3,
  retryDelay: 2000,
  connectionTimeout: 30000,
  idleTimeout: 300000, // 5 minutes
};

/**
 * IMAPConnector manages the connection to Yahoo Mail server via IMAP.
 * Handles authentication, connection lifecycle, and folder listing.
 * Enhanced with retry logic, connection health checks, and auto-reconnect.
 */
export class IMAPConnector {
  private client: ImapFlow | null = null;
  private config: IMAPConfig | null = null;
  private options: Required<ConnectionOptions>;
  private lastActivity: number = 0;
  private reconnecting: boolean = false;
  private connectionHealthy: boolean = false;

  constructor(options?: ConnectionOptions) {
    this.options = { ...DEFAULT_CONNECTION_OPTIONS, ...options };
  }

  /**
   * Connect to Yahoo Mail server using IMAP with retry logic.
   * 
   * @param config - IMAP configuration with credentials
   * @returns ConnectionResult with success status and connection or error
   */
  async connect(config: IMAPConfig): Promise<ConnectionResult> {
    this.config = config;
    let lastError: string = '';

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = await this.attemptConnect(config, attempt);
        if (result.success) {
          this.connectionHealthy = true;
          this.lastActivity = Date.now();
          return result;
        }
        lastError = result.error || 'Unknown error';
        
        // Don't retry on authentication errors
        if (lastError.includes('Authentication failed')) {
          return result;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Wait before retry (except on last attempt)
      if (attempt < this.options.maxRetries) {
        console.log(`[IMAPConnector] Connection attempt ${attempt} failed, retrying in ${this.options.retryDelay}ms...`);
        await this.delay(this.options.retryDelay);
      }
    }

    return {
      success: false,
      error: `Connection failed after ${this.options.maxRetries} attempts: ${lastError}`,
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
