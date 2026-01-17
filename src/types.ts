// Core type definitions for Yahoo Mail Extractor

export interface IMAPConfig {
  email: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
}

export interface FetchFilter {
  folder?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sender?: string;
  subject?: string;
}

export interface ExtractionPattern {
  name: string;
  pattern: string;
  flags?: string;
}

export interface CSVExportOptions {
  outputPath: string;
  delimiter?: string;
  includeHeaders?: boolean;
}

export interface ExcelExportOptions {
  outputPath: string;
  sheetName?: string;
}

export interface DBExportOptions {
  dbPath: string;
  tableName?: string;
}

export interface ExtractorConfig {
  imap: Omit<IMAPConfig, 'password'>;
  filter: FetchFilter;
  pattern: ExtractionPattern;
  export: {
    format: 'csv' | 'excel' | 'sqlite';
    options: CSVExportOptions | ExcelExportOptions | DBExportOptions;
  };
}

export interface RawEmail {
  uid: number;
  date: Date;
  from: string;
  subject: string;
  body: string;
  html?: string;
}

export interface ParsedEmail {
  uid: number;
  date: Date;
  from: string;
  to?: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
}

export interface ExtractionMatch {
  fullMatch: string;
  groups: Record<string, string>;
  index: number;
}

export interface ExtractionResult {
  email: ParsedEmail;
  matches: ExtractionMatch[];
  patternName: string;
}

export interface ProcessingError {
  emailUid: number;
  stage: 'fetch' | 'parse' | 'extract' | 'export';
  error: Error;
  timestamp: Date;
}

export interface ExportRecord {
  emailUid: number;
  emailDate: string;
  emailFrom: string;
  emailTo?: string;
  emailSubject: string;
  matchIndex: number;
  fullMatch: string;
  [groupName: string]: string | number | undefined;
}

/**
 * ExtractionRule - Extended rule interface for discount code extraction workflow
 * Includes patternName and tags for rule management
 * Requirements: 1.4, 4.7
 */
export interface ExtractionRule {
  id: string;
  patternName: string;        // 模式名称 - unique identifier name for the rule
  subjectPattern: string;     // 主题匹配模式 - pattern to match email subjects
  regexPattern: string;       // 正则表达式 - regex to extract codes
  regexFlags: string;         // 正则标志 (g, i, m)
  tags: string[];             // 标签数组 - tags for categorization
  createdAt: string;
  lastUsed?: string;
}
