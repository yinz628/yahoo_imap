// CSV Exporter - Exports extraction results to CSV format
import * as fs from 'fs/promises';
import type { ExtractionResult, CSVExportOptions, ExportRecord } from '../types.js';

/**
 * CSVExporter exports extraction results to CSV format.
 * Supports proper escaping, round-trip serialization, and includes email metadata.
 */
export class CSVExporter {
  /**
   * Export extraction results to a CSV file.
   * 
   * @param results - Array of extraction results to export
   * @param options - CSV export options
   */
  async export(results: ExtractionResult[], options: CSVExportOptions): Promise<void> {
    const csv = this.serialize(results, options.delimiter, options.includeHeaders);
    await fs.writeFile(options.outputPath, csv, 'utf-8');
  }

  /**
   * Serialize extraction results to CSV string.
   * 
   * @param results - Array of extraction results
   * @param delimiter - CSV delimiter (default: ',')
   * @param includeHeaders - Whether to include headers (default: true)
   * @returns CSV string
   */
  serialize(results: ExtractionResult[], delimiter: string = ',', includeHeaders: boolean = true): string {
    const records = this.resultsToRecords(results);
    
    if (records.length === 0) {
      return includeHeaders ? this.getBaseHeaders().join(delimiter) : '';
    }

    // Collect all unique group names across all records
    const groupNames = this.collectGroupNames(records);
    const headers = [...this.getBaseHeaders(), ...groupNames];

    const lines: string[] = [];
    
    if (includeHeaders) {
      lines.push(headers.map(h => this.escapeField(h, delimiter)).join(delimiter));
    }

    for (const record of records) {
      const row = headers.map(header => {
        const value = record[header];
        return this.escapeField(value !== undefined ? String(value) : '', delimiter);
      });
      lines.push(row.join(delimiter));
    }

    return lines.join('\n');
  }

  /**
   * Deserialize CSV string back to export records.
   * 
   * @param csv - CSV string to parse
   * @param delimiter - CSV delimiter (default: ',')
   * @returns Array of export records
   */
  deserialize(csv: string, delimiter: string = ','): ExportRecord[] {
    const lines = this.parseCSVLines(csv);
    
    if (lines.length === 0) {
      return [];
    }

    const headers = this.parseCSVRow(lines[0], delimiter);
    const records: ExportRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVRow(lines[i], delimiter);
      const record: ExportRecord = {
        emailUid: 0,
        emailDate: '',
        emailFrom: '',
        emailSubject: '',
        matchIndex: 0,
        fullMatch: '',
      };

      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        const value = values[j] || '';

        if (header === 'emailUid' || header === 'matchIndex') {
          record[header] = parseInt(value, 10) || 0;
        } else {
          record[header] = value;
        }
      }

      records.push(record);
    }

    return records;
  }


  /**
   * Convert extraction results to export records.
   * Each match becomes a separate record with email metadata.
   */
  private resultsToRecords(results: ExtractionResult[]): ExportRecord[] {
    const records: ExportRecord[] = [];

    for (const result of results) {
      const { email, matches, patternName } = result;
      
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
   * Get base headers for CSV export.
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
   * Escape a field value for CSV format.
   * Handles quotes, delimiters, and newlines.
   */
  private escapeField(value: string, delimiter: string): string {
    // Check if escaping is needed
    const needsEscaping = value.includes('"') || 
                          value.includes(delimiter) || 
                          value.includes('\n') || 
                          value.includes('\r');

    if (!needsEscaping) {
      return value;
    }

    // Escape quotes by doubling them and wrap in quotes
    return '"' + value.replace(/"/g, '""') + '"';
  }

  /**
   * Parse CSV content into lines, handling quoted fields with newlines.
   */
  private parseCSVLines(csv: string): string[] {
    const lines: string[] = [];
    let currentLine = '';
    let inQuotes = false;

    for (let i = 0; i < csv.length; i++) {
      const char = csv[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
        currentLine += char;
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (currentLine.trim()) {
          lines.push(currentLine);
        }
        currentLine = '';
        // Skip \r\n as single newline
        if (char === '\r' && csv[i + 1] === '\n') {
          i++;
        }
      } else {
        currentLine += char;
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Parse a single CSV row into fields.
   */
  private parseCSVRow(row: string, delimiter: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
      const char = row[i];

      if (char === '"') {
        if (inQuotes && row[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        fields.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }

    fields.push(currentField);
    return fields;
  }
}
