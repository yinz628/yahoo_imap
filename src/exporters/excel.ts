// Excel Exporter - Exports extraction results to Excel format
import ExcelJS from 'exceljs';
import type { ExtractionResult, ExcelExportOptions, ExportRecord } from '../types.js';

/**
 * ExcelExporter exports extraction results to Excel (XLSX) format.
 * Includes email metadata and proper formatting.
 */
export class ExcelExporter {
  /**
   * Export extraction results to an Excel file.
   * 
   * @param results - Array of extraction results to export
   * @param options - Excel export options
   */
  async export(results: ExtractionResult[], options: ExcelExportOptions): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheetName = options.sheetName || 'Extracted Data';
    const worksheet = workbook.addWorksheet(sheetName);

    const records = this.resultsToRecords(results);
    const groupNames = this.collectGroupNames(records);
    const headers = [...this.getBaseHeaders(), ...groupNames];

    // Add headers with formatting
    worksheet.columns = headers.map(header => ({
      header,
      key: header,
      width: this.getColumnWidth(header),
    }));

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    for (const record of records) {
      const rowData: Record<string, string | number> = {};
      for (const header of headers) {
        const value = record[header];
        rowData[header] = value !== undefined ? value : '';
      }
      worksheet.addRow(rowData);
    }

    // Auto-filter on headers
    if (records.length > 0) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }

    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    await workbook.xlsx.writeFile(options.outputPath);
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
   * Get base headers for Excel export.
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
   * Get appropriate column width based on header name.
   */
  private getColumnWidth(header: string): number {
    const widths: Record<string, number> = {
      emailUid: 12,
      emailDate: 22,
      emailFrom: 30,
      emailSubject: 40,
      matchIndex: 12,
      fullMatch: 50,
    };
    return widths[header] || 20;
  }
}
