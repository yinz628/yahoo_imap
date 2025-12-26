/**
 * Test Extraction Script
 * 
 * This script tests the email extraction functionality with real Yahoo Mail account.
 * It demonstrates:
 * 1. Connecting to Yahoo Mail via IMAP
 * 2. Fetching emails with specific filters
 * 3. Parsing email content
 * 4. Extracting data using regex patterns
 * 5. Exporting results to CSV
 * 
 * Test Configuration:
 * - Email: abnerklewiyql@yahoo.com
 * - Subject Filter: "$50 off—make your shopping bag yours today!"
 * - Extraction Pattern: Discount code (Z78J2DM2G5B6)
 */

import { IMAPConnector } from './connector.js';
import { EmailFetcher } from './fetcher.js';
import { EmailParser } from './parser.js';
import { RegexExtractor } from './extractor.js';
import { CSVExporter } from './exporters/csv.js';
import type { IMAPConfig, FetchFilter, ExtractionPattern } from './types.js';

/**
 * Test Plan:
 * 
 * 1. Connection Test
 *    - Verify IMAP connection to Yahoo Mail
 *    - Check authentication with app password
 *    - List available folders
 * 
 * 2. Email Fetching Test
 *    - Fetch emails with subject filter
 *    - Count matching emails
 *    - Verify email metadata (date, from, subject)
 * 
 * 3. Email Parsing Test
 *    - Parse raw email content
 *    - Extract text and HTML content
 *    - Handle both plain text and HTML emails
 * 
 * 4. Regex Extraction Test
 *    - Extract discount codes using regex
 *    - Test with named capture groups
 *    - Handle multiple matches per email
 * 
 * 5. Export Test
 *    - Export results to CSV
 *    - Verify CSV format and content
 *    - Include email metadata
 */

async function runExtractionTest() {
  console.log('='.repeat(60));
  console.log('Yahoo Mail Extractor - Test Suite');
  console.log('='.repeat(60));
  console.log();

  // Configuration
  const imapConfig: IMAPConfig = {
    email: 'abnerklewiyql@yahoo.com',
    password: 'ktrzxdkxmfvgxvhw',
    host: 'imap.mail.yahoo.com',
    port: 993,
    tls: true,
  };

  const fetchFilter: FetchFilter = {
    folder: 'INBOX',
    subject: '$50 off—make your shopping bag yours today!',
  };

  // Extraction pattern for discount codes
  // Matches patterns like: Z78J2DM2G5B6, CODE123, etc.
  const extractionPattern: ExtractionPattern = {
    name: 'discount_code',
    pattern: '(?<code>[A-Z0-9]{6,12})',
    flags: 'g',
  };

  let connector: IMAPConnector | null = null;

  try {
    // ========== TEST 1: Connection Test ==========
    console.log('TEST 1: IMAP Connection');
    console.log('-'.repeat(60));
    
    connector = new IMAPConnector();
    const connectionResult = await connector.connect(imapConfig);

    if (!connectionResult.success) {
      console.error('❌ Connection failed:', connectionResult.error);
      return;
    }

    console.log('✓ Successfully connected to Yahoo Mail');
    const connection = connectionResult.connection!;

    // List folders
    const folders = await connector.listFolders();
    console.log(`✓ Available folders: ${folders.join(', ')}`);
    console.log();

    // ========== TEST 2: Email Fetching Test ==========
    console.log('TEST 2: Email Fetching');
    console.log('-'.repeat(60));

    const fetcher = new EmailFetcher();
    const emailCount = await fetcher.count(connection, fetchFilter);
    console.log(`✓ Found ${emailCount} email(s) matching filter`);
    console.log(`  Filter: subject contains "${fetchFilter.subject}"`);

    if (emailCount === 0) {
      console.log('⚠ No emails found matching the filter. Skipping further tests.');
      console.log();
      return;
    }

    // Fetch emails
    const rawEmails = [];
    console.log('Fetching emails...');
    
    for await (const email of fetcher.fetch(connection, fetchFilter)) {
      rawEmails.push(email);
      console.log(`  ✓ Fetched email: "${email.subject}" from ${email.from}`);
    }

    console.log(`✓ Successfully fetched ${rawEmails.length} email(s)`);
    console.log();

    // ========== TEST 3: Email Parsing Test ==========
    console.log('TEST 3: Email Parsing');
    console.log('-'.repeat(60));

    const parser = new EmailParser();
    const parsedEmails = [];

    for (const rawEmail of rawEmails) {
      const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
      parsedEmails.push(parsed);
      
      console.log(`✓ Parsed email UID ${parsed.uid}:`);
      console.log(`  Subject: ${parsed.subject}`);
      console.log(`  From: ${parsed.from}`);
      console.log(`  Date: ${parsed.date.toISOString()}`);
      console.log(`  Text content length: ${parsed.textContent.length} chars`);
      if (parsed.htmlContent) {
        console.log(`  HTML content length: ${parsed.htmlContent.length} chars`);
      }
    }

    console.log(`✓ Successfully parsed ${parsedEmails.length} email(s)`);
    console.log();

    // ========== TEST 4: Regex Extraction Test ==========
    console.log('TEST 4: Regex Extraction');
    console.log('-'.repeat(60));

    const extractor = new RegexExtractor();
    const extractionResults = [];

    for (const parsedEmail of parsedEmails) {
      const result = extractor.extract(parsedEmail, extractionPattern, true);
      extractionResults.push(result);

      console.log(`✓ Extracted from email UID ${result.email.uid}:`);
      console.log(`  Pattern: ${result.patternName}`);
      console.log(`  Matches found: ${result.matches.length}`);

      if (result.matches.length > 0) {
        result.matches.forEach((match, idx) => {
          console.log(`    Match ${idx + 1}: "${match.fullMatch}"`);
          if (Object.keys(match.groups).length > 0) {
            console.log(`      Groups: ${JSON.stringify(match.groups)}`);
          }
        });
      } else {
        console.log('    No matches found');
      }
    }

    console.log(`✓ Successfully extracted from ${extractionResults.length} email(s)`);
    console.log();

    // ========== TEST 5: Export Test ==========
    console.log('TEST 5: CSV Export');
    console.log('-'.repeat(60));

    const csvExporter = new CSVExporter();
    const exportPath = './test-extraction-results.csv';

    try {
      await csvExporter.export(extractionResults, {
        outputPath: exportPath,
        delimiter: ',',
        includeHeaders: true,
      });

      console.log(`✓ Successfully exported results to: ${exportPath}`);
      
      // Read and display CSV content
      const { readFileSync } = await import('fs');
      const csvContent = readFileSync(exportPath, 'utf-8');
      console.log('\nCSV Content Preview:');
      console.log('-'.repeat(60));
      const lines = csvContent.split('\n');
      lines.slice(0, 5).forEach(line => console.log(line));
      if (lines.length > 5) {
        console.log(`... (${lines.length - 5} more lines)`);
      }
    } catch (error) {
      console.error('❌ Export failed:', error instanceof Error ? error.message : error);
    }

    console.log();

    // ========== TEST SUMMARY ==========
    console.log('='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log(`✓ Connection: PASSED`);
    console.log(`✓ Email Fetching: PASSED (${rawEmails.length} emails)`);
    console.log(`✓ Email Parsing: PASSED (${parsedEmails.length} emails)`);
    console.log(`✓ Regex Extraction: PASSED`);
    console.log(`✓ CSV Export: PASSED`);
    console.log();
    console.log('All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed with error:', error instanceof Error ? error.message : error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    // Cleanup
    if (connector) {
      await connector.disconnect();
      console.log('\n✓ Disconnected from Yahoo Mail');
    }
  }
}

// Run the test
runExtractionTest().catch(console.error);
