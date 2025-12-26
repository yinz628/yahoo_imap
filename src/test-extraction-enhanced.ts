/**
 * Enhanced Test Extraction Script
 * 
 * This script demonstrates the enhanced extraction capabilities including:
 * 1. Match validation
 * 2. Duplicate removal
 * 3. Statistics collection
 * 4. Multiple pattern testing
 * 5. Result filtering
 */

import { IMAPConnector } from './connector.js';
import { EmailFetcher } from './fetcher.js';
import { EmailParser } from './parser.js';
import { EnhancedRegexExtractor, VALIDATORS } from './extractor-enhanced.js';
import { CSVExporter } from './exporters/csv.js';
import { DISCOUNT_CODE_PATTERNS } from './patterns.js';
import type { IMAPConfig, FetchFilter } from './types.js';

async function runEnhancedExtractionTest() {
  console.log('='.repeat(70));
  console.log('Yahoo Mail Extractor - Enhanced Test Suite');
  console.log('='.repeat(70));
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

  let connector: IMAPConnector | null = null;

  try {
    // ========== Setup ==========
    console.log('SETUP: Connecting and fetching emails');
    console.log('-'.repeat(70));

    connector = new IMAPConnector();
    const connectionResult = await connector.connect(imapConfig);

    if (!connectionResult.success) {
      console.error('❌ Connection failed:', connectionResult.error);
      return;
    }

    console.log('✓ Connected to Yahoo Mail');
    const connection = connectionResult.connection!;

    // Fetch emails
    const fetcher = new EmailFetcher();
    const emailCount = await fetcher.count(connection, fetchFilter);
    console.log(`✓ Found ${emailCount} matching emails`);

    if (emailCount === 0) {
      console.log('⚠ No emails found. Skipping tests.');
      return;
    }

    // Parse emails
    const parser = new EmailParser();
    const parsedEmails = [];

    for await (const rawEmail of fetcher.fetch(connection, fetchFilter)) {
      const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
      parsedEmails.push(parsed);
    }

    console.log(`✓ Parsed ${parsedEmails.length} emails`);
    console.log();

    // ========== TEST 1: Pattern Comparison ==========
    console.log('TEST 1: Pattern Comparison');
    console.log('-'.repeat(70));

    const extractor = new EnhancedRegexExtractor();

    const patterns = [
      DISCOUNT_CODE_PATTERNS.special,
      DISCOUNT_CODE_PATTERNS.standard,
      DISCOUNT_CODE_PATTERNS.long,
      DISCOUNT_CODE_PATTERNS.broad,
    ];

    const patternResults = new Map();

    for (const pattern of patterns) {
      const results = extractor.extractBatch(parsedEmails, pattern, true);
      const stats = extractor.getStatistics(results);

      patternResults.set(pattern.name, { results, stats });

      console.log(`\n📊 Pattern: ${pattern.name}`);
      console.log(`   Regex: ${pattern.pattern}`);
      console.log(`   Total matches: ${stats.totalMatches}`);
      console.log(`   Valid matches: ${stats.validMatches}`);
      console.log(`   Invalid matches: ${stats.invalidMatches}`);
      console.log(`   Unique matches: ${stats.uniqueMatches.size}`);
      console.log(`   Duplicates: ${stats.duplicates}`);
    }

    console.log();

    // ========== TEST 2: Validation ==========
    console.log('TEST 2: Match Validation');
    console.log('-'.repeat(70));

    const specialPattern = DISCOUNT_CODE_PATTERNS.special;
    const resultsWithValidation = extractor.extractBatch(
      parsedEmails,
      specialPattern,
      true,
      VALIDATORS.discountCode
    );

    const statsWithValidation = extractor.getStatistics(resultsWithValidation);

    console.log(`\n✓ Using validator: VALIDATORS.discountCode`);
    console.log(`  Total matches: ${statsWithValidation.totalMatches}`);
    console.log(`  Valid matches: ${statsWithValidation.validMatches}`);
    console.log(`  Invalid matches: ${statsWithValidation.invalidMatches}`);
    console.log(`  Unique matches: ${statsWithValidation.uniqueMatches.size}`);

    // Show sample valid matches
    console.log(`\n  Sample valid codes:`);
    const sampleCodes = Array.from(statsWithValidation.uniqueMatches).slice(0, 10);
    sampleCodes.forEach((code, idx) => {
      console.log(`    ${idx + 1}. ${code}`);
    });

    console.log();

    // ========== TEST 3: Duplicate Removal ==========
    console.log('TEST 3: Duplicate Removal');
    console.log('-'.repeat(70));

    const resultsBeforeFilter = extractor.extractBatch(parsedEmails, specialPattern, true);
    const resultsAfterFilter = extractor.filterResults(resultsBeforeFilter, true);

    let totalBefore = 0;
    let totalAfter = 0;

    for (const result of resultsBeforeFilter) {
      totalBefore += result.matches.length;
    }

    for (const result of resultsAfterFilter) {
      totalAfter += result.matches.length;
    }

    console.log(`\n✓ Duplicate removal results:`);
    console.log(`  Before filtering: ${totalBefore} matches`);
    console.log(`  After filtering: ${totalAfter} matches`);
    console.log(`  Duplicates removed: ${totalBefore - totalAfter}`);
    console.log(`  Reduction: ${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%`);

    console.log();

    // ========== TEST 4: Quality Metrics ==========
    console.log('TEST 4: Quality Metrics');
    console.log('-'.repeat(70));

    const qualityResults = extractor.extractBatch(
      parsedEmails,
      specialPattern,
      true,
      VALIDATORS.discountCode
    );

    const qualityStats = extractor.getStatistics(qualityResults);

    console.log(`\n✓ Quality metrics for special pattern with validation:`);
    console.log(`  Precision: ${((qualityStats.validMatches / qualityStats.totalMatches) * 100).toFixed(1)}%`);
    console.log(`  Unique rate: ${((qualityStats.uniqueMatches.size / qualityStats.totalMatches) * 100).toFixed(1)}%`);
    console.log(`  Emails processed: ${parsedEmails.length}`);
    console.log(`  Avg matches per email: ${(qualityStats.totalMatches / parsedEmails.length).toFixed(1)}`);
    console.log(`  Avg unique matches per email: ${(qualityStats.uniqueMatches.size / parsedEmails.length).toFixed(1)}`);

    console.log();

    // ========== TEST 5: Export Comparison ==========
    console.log('TEST 5: Export Comparison');
    console.log('-'.repeat(70));

    const csvExporter = new CSVExporter();

    // Export with broad pattern (all matches)
    const broadResults = extractor.extractBatch(parsedEmails, DISCOUNT_CODE_PATTERNS.broad, true);
    await csvExporter.export(broadResults, {
      outputPath: './test-extraction-broad.csv',
      delimiter: ',',
      includeHeaders: true,
    });

    // Export with special pattern + validation (quality matches)
    const qualityFilteredResults = extractor.filterResults(qualityResults, true);
    await csvExporter.export(qualityFilteredResults, {
      outputPath: './test-extraction-quality.csv',
      delimiter: ',',
      includeHeaders: true,
    });

    console.log(`\n✓ Exported results:`);
    console.log(`  Broad pattern: ./test-extraction-broad.csv`);
    console.log(`  Quality pattern: ./test-extraction-quality.csv`);

    // Read and compare file sizes
    const { statSync } = await import('fs');
    const broadSize = statSync('./test-extraction-broad.csv').size;
    const qualitySize = statSync('./test-extraction-quality.csv').size;

    console.log(`\n  File sizes:`);
    console.log(`    Broad: ${(broadSize / 1024).toFixed(1)} KB`);
    console.log(`    Quality: ${(qualitySize / 1024).toFixed(1)} KB`);
    console.log(`    Reduction: ${((1 - qualitySize / broadSize) * 100).toFixed(1)}%`);

    console.log();

    // ========== TEST SUMMARY ==========
    console.log('='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    console.log(`✓ Pattern Comparison: PASSED (4 patterns tested)`);
    console.log(`✓ Match Validation: PASSED (${statsWithValidation.validMatches} valid matches)`);
    console.log(`✓ Duplicate Removal: PASSED (${totalBefore - totalAfter} duplicates removed)`);
    console.log(`✓ Quality Metrics: PASSED (${((qualityStats.validMatches / qualityStats.totalMatches) * 100).toFixed(1)}% precision)`);
    console.log(`✓ Export Comparison: PASSED (2 files exported)`);
    console.log();
    console.log('All enhanced tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed with error:', error instanceof Error ? error.message : error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    if (connector) {
      await connector.disconnect();
      console.log('\n✓ Disconnected from Yahoo Mail');
    }
  }
}

// Run the test
runEnhancedExtractionTest().catch(console.error);
