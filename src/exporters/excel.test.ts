// Excel Exporter Tests
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { ExcelExporter } from './excel.js';
import type { ExtractionResult } from '../types.js';

describe('ExcelExporter', () => {
  const exporter = new ExcelExporter();
  const testOutputPath = path.join(process.cwd(), 'test-output.xlsx');

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(testOutputPath);
    } catch {
      // File may not exist, ignore
    }
  });

  describe('export', () => {
    it('should export empty results with headers only', async () => {
      await exporter.export([], { outputPath: testOutputPath });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testOutputPath);
      
      const worksheet = workbook.getWorksheet('Extracted Data');
      expect(worksheet).toBeDefined();
      
      // Check headers exist
      const headerRow = worksheet!.getRow(1);
      expect(headerRow.getCell(1).value).toBe('emailUid');
      expect(headerRow.getCell(2).value).toBe('emailDate');
      expect(headerRow.getCell(3).value).toBe('emailFrom');
      expect(headerRow.getCell(4).value).toBe('emailSubject');
    });

    it('should export results with matches', async () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 1,
          date: new Date('2024-01-15T10:30:00Z'),
          from: 'test@example.com',
          subject: 'Test Subject',
          textContent: 'Test content',
        },
        matches: [{
          fullMatch: 'matched text',
          groups: { name: 'John', value: '123' },
          index: 0,
        }],
        patternName: 'testPattern',
      }];

      await exporter.export(results, { outputPath: testOutputPath });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testOutputPath);
      
      const worksheet = workbook.getWorksheet('Extracted Data');
      expect(worksheet).toBeDefined();
      
      // Check data row
      const dataRow = worksheet!.getRow(2);
      expect(dataRow.getCell(1).value).toBe(1); // emailUid
      expect(dataRow.getCell(3).value).toBe('test@example.com'); // emailFrom
      expect(dataRow.getCell(4).value).toBe('Test Subject'); // emailSubject
      expect(dataRow.getCell(6).value).toBe('matched text'); // fullMatch
    });

    it('should use custom sheet name', async () => {
      await exporter.export([], { 
        outputPath: testOutputPath,
        sheetName: 'Custom Sheet'
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testOutputPath);
      
      const worksheet = workbook.getWorksheet('Custom Sheet');
      expect(worksheet).toBeDefined();
    });

    it('should include email metadata for emails with no matches', async () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 42,
          date: new Date('2024-06-20T15:00:00Z'),
          from: 'sender@test.com',
          subject: 'No matches here',
          textContent: 'Some content without matches',
        },
        matches: [],
        patternName: 'testPattern',
      }];

      await exporter.export(results, { outputPath: testOutputPath });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testOutputPath);
      
      const worksheet = workbook.getWorksheet('Extracted Data');
      expect(worksheet).toBeDefined();
      
      // Check data row exists with metadata
      const dataRow = worksheet!.getRow(2);
      expect(dataRow.getCell(1).value).toBe(42); // emailUid
      expect(dataRow.getCell(3).value).toBe('sender@test.com'); // emailFrom
      expect(dataRow.getCell(4).value).toBe('No matches here'); // emailSubject
      expect(dataRow.getCell(6).value).toBe(''); // fullMatch should be empty
    });

    it('should include named capture groups as columns', async () => {
      const results: ExtractionResult[] = [{
        email: {
          uid: 1,
          date: new Date('2024-01-15'),
          from: 'test@example.com',
          subject: 'Test',
          textContent: 'content',
        },
        matches: [{
          fullMatch: 'Order #12345',
          groups: { orderNumber: '12345', status: 'pending' },
          index: 0,
        }],
        patternName: 'orderPattern',
      }];

      await exporter.export(results, { outputPath: testOutputPath });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(testOutputPath);
      
      const worksheet = workbook.getWorksheet('Extracted Data');
      expect(worksheet).toBeDefined();
      
      // Check headers include named groups
      const headerRow = worksheet!.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell) => {
        headers.push(String(cell.value));
      });
      
      expect(headers).toContain('orderNumber');
      expect(headers).toContain('status');
    });
  });
});
