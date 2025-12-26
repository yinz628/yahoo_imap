// SQLite Exporter - Exports extraction results to SQLite database
import Database from 'better-sqlite3';
import type { ExtractionResult, DBExportOptions, ExportRecord } from '../types.js';

/**
 * SQLiteExporter exports extraction results to a SQLite database.
 * Creates table schema dynamically based on extraction groups and includes email metadata.
 */
export class SQLiteExporter {
  /**
   * Export extraction results to a SQLite database.
   * 
   * @param results - Array of extraction results to export
   * @param options - Database export options
   */
  async export(results: ExtractionResult[], options: DBExportOptions): Promise<void> {
    const tableName = options.tableName || 'extractions';
    const records = this.resultsToRecords(results);
    const groupNames = this.collectGroupNames(records);
    
    const db = new Database(options.dbPath);
    
    try {
      // Create table with dynamic schema
      this.createTable(db, tableName, groupNames);
      
      // Insert records
      this.insertRecords(db, tableName, records, groupNames);
    } finally {
      db.close();
    }
  }

  /**
   * Query the database with a SQL statement.
   * 
   * @param dbPath - Path to the SQLite database
   * @param sql - SQL query to execute
   * @returns Array of result rows
   */
  async query(dbPath: string, sql: string): Promise<any[]> {
    const db = new Database(dbPath);
    try {
      const stmt = db.prepare(sql);
      return stmt.all();
    } finally {
      db.close();
    }
  }

  /**
   * Create the extractions table with dynamic columns for capture groups.
   */
  private createTable(db: Database.Database, tableName: string, groupNames: string[]): void {
    // Sanitize table name to prevent SQL injection
    const safeTableName = this.sanitizeIdentifier(tableName);
    
    // Build column definitions
    const baseColumns = [
      'id INTEGER PRIMARY KEY AUTOINCREMENT',
      'emailUid INTEGER NOT NULL',
      'emailDate TEXT NOT NULL',
      'emailFrom TEXT NOT NULL',
      'emailSubject TEXT NOT NULL',
      'matchIndex INTEGER NOT NULL',
      'fullMatch TEXT NOT NULL',
    ];
    
    // Add dynamic columns for capture groups
    const groupColumns = groupNames.map(name => 
      `${this.sanitizeIdentifier(name)} TEXT`
    );
    
    const allColumns = [...baseColumns, ...groupColumns];
    
    // Drop existing table and create new one
    db.exec(`DROP TABLE IF EXISTS ${safeTableName}`);
    db.exec(`CREATE TABLE ${safeTableName} (${allColumns.join(', ')})`);
    
    // Create index on emailUid for faster lookups
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${safeTableName}_emailUid ON ${safeTableName}(emailUid)`);
  }

  /**
   * Insert records into the database using a prepared statement.
   */
  private insertRecords(
    db: Database.Database, 
    tableName: string, 
    records: ExportRecord[], 
    groupNames: string[]
  ): void {
    if (records.length === 0) return;
    
    const safeTableName = this.sanitizeIdentifier(tableName);
    const baseHeaders = this.getBaseHeaders();
    const allHeaders = [...baseHeaders, ...groupNames];
    
    // Build parameterized INSERT statement
    const columns = allHeaders.map(h => this.sanitizeIdentifier(h)).join(', ');
    const placeholders = allHeaders.map(() => '?').join(', ');
    const sql = `INSERT INTO ${safeTableName} (${columns}) VALUES (${placeholders})`;
    
    const stmt = db.prepare(sql);
    
    // Use transaction for better performance
    const insertMany = db.transaction((recs: ExportRecord[]) => {
      for (const record of recs) {
        const values = allHeaders.map(header => {
          const value = record[header];
          return value !== undefined ? value : null;
        });
        stmt.run(...values);
      }
    });
    
    insertMany(records);
  }

  /**
   * Convert extraction results to export records.
   * Each match becomes a separate record with email metadata.
   */
  private resultsToRecords(results: ExtractionResult[]): ExportRecord[] {
    const records: ExportRecord[] = [];

    for (const result of results) {
      const { email, matches } = result;
      
      if (matches.length === 0) {
        // Include email with empty extraction fields if no matches
        records.push({
          emailUid: email.uid,
          emailDate: email.date.toISOString(),
          emailFrom: email.from,
          emailSubject: email.subject,
          matchIndex: 0,
          fullMatch: '',
        });
      } else {
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const record: ExportRecord = {
            emailUid: email.uid,
            emailDate: email.date.toISOString(),
            emailFrom: email.from,
            emailSubject: email.subject,
            matchIndex: i,
            fullMatch: match.fullMatch,
          };

          // Add named capture groups
          for (const [key, value] of Object.entries(match.groups)) {
            record[key] = value;
          }

          records.push(record);
        }
      }
    }

    return records;
  }

  /**
   * Get base headers for database export.
   */
  private getBaseHeaders(): string[] {
    return ['emailUid', 'emailDate', 'emailFrom', 'emailSubject', 'matchIndex', 'fullMatch'];
  }

  /**
   * Collect all unique group names from records.
   */
  private collectGroupNames(records: ExportRecord[]): string[] {
    const baseHeaders = new Set(this.getBaseHeaders());
    const groupNames = new Set<string>();

    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!baseHeaders.has(key)) {
          groupNames.add(key);
        }
      }
    }

    return Array.from(groupNames).sort();
  }

  /**
   * Sanitize an identifier (table name or column name) to prevent SQL injection.
   * Only allows alphanumeric characters and underscores.
   */
  private sanitizeIdentifier(identifier: string): string {
    // Replace any non-alphanumeric/underscore characters with underscore
    const sanitized = identifier.replace(/[^a-zA-Z0-9_]/g, '_');
    // Ensure it doesn't start with a number
    if (/^[0-9]/.test(sanitized)) {
      return '_' + sanitized;
    }
    return sanitized;
  }
}
