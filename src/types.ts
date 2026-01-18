// Core type definitions for Yahoo Mail Extractor

/**
 * IMAP server configuration
 * Contains credentials and connection settings for IMAP server
 */
export interface IMAPConfig {
  /** Email address for authentication */
  email: string;
  /** Password or app-specific password for authentication */
  password: string;
  /** IMAP server hostname (e.g., imap.mail.yahoo.com) */
  host: string;
  /** IMAP server port (typically 993 for TLS) */
  port: number;
  /** Whether to use TLS/SSL encryption */
  tls: boolean;
}

/**
 * Email fetch filter criteria
 * Defines which emails to fetch based on various criteria
 */
export interface FetchFilter {
  /** Mailbox folder to fetch from (e.g., 'INBOX', 'Sent') */
  folder?: string;
  /** Fetch emails from this date onwards */
  dateFrom?: Date;
  /** Fetch emails up to this date */
  dateTo?: Date;
  /** Filter by sender email address */
  sender?: string;
  /** Filter by subject line (partial match) */
  subject?: string;
}

/**
 * Regular expression pattern for data extraction
 * Defines a named pattern with regex and optional flags
 */
export interface ExtractionPattern {
  /** Human-readable name for the pattern */
  name: string;
  /** Regular expression pattern string */
  pattern: string;
  /** Optional regex flags (e.g., 'gi' for global case-insensitive) */
  flags?: string;
}

/**
 * CSV export configuration options
 */
export interface CSVExportOptions {
  /** Output file path for the CSV file */
  outputPath: string;
  /** CSV delimiter character (default: ',') */
  delimiter?: string;
  /** Whether to include column headers (default: true) */
  includeHeaders?: boolean;
}

/**
 * Excel export configuration options
 */
export interface ExcelExportOptions {
  /** Output file path for the Excel file */
  outputPath: string;
  /** Name of the worksheet (default: 'Sheet1') */
  sheetName?: string;
}

/**
 * SQLite database export configuration options
 */
export interface DBExportOptions {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Name of the table to create/insert into (default: 'extractions') */
  tableName?: string;
}

/**
 * Complete extractor configuration
 * Combines IMAP settings, fetch filters, extraction pattern, and export options
 */
export interface ExtractorConfig {
  /** IMAP configuration (without password for security) */
  imap: Omit<IMAPConfig, 'password'>;
  /** Email fetch filter criteria */
  filter: FetchFilter;
  /** Extraction pattern to apply */
  pattern: ExtractionPattern;
  /** Export configuration */
  export: {
    /** Export format type */
    format: 'csv' | 'excel' | 'sqlite';
    /** Format-specific export options */
    options: CSVExportOptions | ExcelExportOptions | DBExportOptions;
  };
}

/**
 * Raw email data as fetched from IMAP server
 * Contains basic email metadata and content
 */
export interface RawEmail {
  /** Unique identifier for the email in the mailbox */
  uid: number;
  /** Email send date */
  date: Date;
  /** Sender email address */
  from: string;
  /** Email subject line */
  subject: string;
  /** Plain text body content */
  body: string;
  /** HTML body content (if available) */
  html?: string;
}

/**
 * Parsed email with structured content
 * Result of parsing a raw email through mailparser
 */
export interface ParsedEmail {
  /** Unique identifier for the email in the mailbox */
  uid: number;
  /** Email send date */
  date: Date;
  /** Sender email address */
  from: string;
  /** Recipient email address(es) */
  to?: string;
  /** Email subject line */
  subject: string;
  /** Extracted plain text content */
  textContent: string;
  /** Extracted HTML content (if available) */
  htmlContent?: string;
}

/**
 * Single regex match result
 * Contains the matched text, captured groups, and position
 */
export interface ExtractionMatch {
  /** The complete matched string */
  fullMatch: string;
  /** Named capture groups from the regex pattern */
  groups: Record<string, string>;
  /** Character index where the match was found */
  index: number;
}

/**
 * Complete extraction result for an email
 * Links an email with all matches found by the extraction pattern
 */
export interface ExtractionResult {
  /** The parsed email that was processed */
  email: ParsedEmail;
  /** All matches found in the email */
  matches: ExtractionMatch[];
  /** Name of the pattern that was applied */
  patternName: string;
}

/**
 * Error that occurred during email processing
 * Tracks which email failed and at what stage
 */
export interface ProcessingError {
  /** UID of the email that failed to process */
  emailUid: number;
  /** Processing stage where the error occurred */
  stage: 'fetch' | 'parse' | 'extract' | 'export';
  /** The error that occurred */
  error: Error;
  /** When the error occurred */
  timestamp: Date;
}

/**
 * Flattened export record for CSV/Excel/Database export
 * Each record represents one match from one email
 */
export interface ExportRecord {
  /** UID of the source email */
  emailUid: number;
  /** Email send date (formatted as string) */
  emailDate: string;
  /** Sender email address */
  emailFrom: string;
  /** Recipient email address(es) */
  emailTo?: string;
  /** Email subject line */
  emailSubject: string;
  /** Index of this match within the email (0-based) */
  matchIndex: number;
  /** The complete matched string */
  fullMatch: string;
  /** Dynamic properties for captured groups (group name -> value) */
  [groupName: string]: string | number | undefined;
}

/**
 * ExtractionRule - Extended rule interface for discount code extraction workflow
 * Includes patternName and tags for rule management
 * 
 * Requirements: 1.4, 4.7
 */
export interface ExtractionRule {
  /** Unique identifier for the rule */
  id: string;
  /** Pattern name - unique identifier name for the rule */
  patternName: string;
  /** Subject pattern - regex pattern to match email subjects */
  subjectPattern: string;
  /** Regex pattern - regex to extract codes from email content */
  regexPattern: string;
  /** Regex flags (e.g., 'g' for global, 'i' for case-insensitive, 'm' for multiline) */
  regexFlags: string;
  /** Tags for categorization and filtering */
  tags: string[];
  /** ISO timestamp when the rule was created */
  createdAt: string;
  /** ISO timestamp when the rule was last used (optional) */
  lastUsed?: string;
}

/**
 * Connection options for IMAP retry and timeout behavior
 * Controls how the connector handles connection failures and timeouts
 * 
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 2.1, 2.5, 2.7
 */
export interface ConnectionOptions {
  /** Maximum number of connection retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds between retries (default: 2000) */
  retryDelay?: number;
  /** Maximum retry delay in milliseconds for exponential backoff (default: 30000) */
  retryDelayMax?: number;
  /** Connection timeout in milliseconds (default: 30000) */
  connectionTimeout?: number;
  /** Timeout for individual IMAP operations in milliseconds (default: 20000) */
  operationTimeout?: number;
  /** Idle timeout for Keep-Alive mechanism in milliseconds (default: 300000) */
  idleTimeout?: number;
}

/**
 * Supported email provider types
 * Determines which provider-specific configuration to use
 * 
 * Requirements: 1.1, 1.2, 7.1
 */
export type EmailProvider = 'yahoo' | 'gmail' | 'custom';

/**
 * IMAP server connection settings
 * Standard IMAP server configuration parameters
 */
export interface IMAPServerSettings {
  /** IMAP server hostname */
  host: string;
  /** IMAP server port (typically 993 for TLS) */
  port: number;
  /** Whether to use TLS/SSL encryption */
  tls: boolean;
}

/**
 * Provider-specific connection options configuration
 * Different providers have different optimal timeout and retry settings
 * 
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.6
 */
export interface ProviderConnectionOptions {
  /** Yahoo Mail optimized settings (fast and stable) */
  yahoo: Required<ConnectionOptions>;
  /** Gmail optimized settings (slower response, needs more patience) */
  gmail: Required<ConnectionOptions>;
  /** Default settings for other IMAP providers */
  default: Required<ConnectionOptions>;
}

/**
 * Result of an IMAP connection attempt
 * Indicates success or failure with appropriate details
 */
export interface ConnectionResult {
  /** Whether the connection was successful */
  success: boolean;
  /** Error message if connection failed */
  error?: string;
  /** ImapFlow connection instance if successful */
  connection?: any; // ImapFlow type
}

/**
 * Error types for classification
 * Used by ErrorClassifier to categorize connection errors
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */
export enum ErrorType {
  /** Authentication error - credentials invalid, should not retry */
  AUTHENTICATION = 'authentication',
  /** Network error - connection issues, can retry */
  NETWORK = 'network',
  /** Timeout error - operation took too long, can retry */
  TIMEOUT = 'timeout',
  /** Rate limit error - too many requests, need longer delay */
  RATE_LIMIT = 'rate_limit',
  /** Server error - temporary server issue, can retry */
  SERVER_ERROR = 'server_error',
  /** Unknown error - unclassified error */
  UNKNOWN = 'unknown'
}

/**
 * Recovery strategy for handling errors
 * Defines how to respond to different error types
 * 
 * Requirements: 2.4, 2.5, 2.6, 10.7, 10.8
 */
export interface RecoveryStrategy {
  /** Whether to retry after this error */
  shouldRetry: boolean;
  /** Delay in milliseconds before retry */
  delay: number;
  /** Maximum number of retry attempts for this error type */
  maxAttempts: number;
  /** User-friendly message explaining the error and action */
  userMessage: string;
}
