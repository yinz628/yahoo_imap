/**
 * Frontend API Test Script
 * 
 * This script tests all the API endpoints used by the frontend to diagnose issues:
 * 1. Connection timeout issues
 * 2. Validation timeout issues
 * 3. Extraction result issues
 */

import { IMAPConnector, YAHOO_IMAP_DEFAULTS } from './connector.js';
import { EmailFetcher } from './fetcher.js';
import { EmailParser } from './parser.js';
import { RegexExtractor } from './extractor.js';
import type { IMAPConfig, FetchFilter, ExtractionPattern } from './types.js';

// Test configuration
const TEST_CONFIG = {
  email: 'abnerklewiyql@yahoo.com',
  password: 'ktrzxdkxmfvgxvhw',
  subject: '$50 off—make your shopping bag yours today!',
  pattern: '(?<code>Z[0-9A-Z]{11})',
};

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'TIMEOUT';
  duration: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logResult(result: TestResult) {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'TIMEOUT' ? '⏱️' : '❌';
  console.log(`${icon} ${result.name}: ${result.status} (${result.duration}ms)`);
  if (result.details) {
    console.log(`   Details: ${result.details}`);
  }
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  results.push(result);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

async function testConnection(): Promise<{ connector: IMAPConnector; connection: any } | null> {
  const startTime = Date.now();
  const testName = 'API: /api/connect';
  
  log(`Testing ${testName}...`);
  
  const connector = new IMAPConnector();
  const config: IMAPConfig = {
    email: TEST_CONFIG.email,
    password: TEST_CONFIG.password,
    host: YAHOO_IMAP_DEFAULTS.host,
    port: YAHOO_IMAP_DEFAULTS.port,
    tls: YAHOO_IMAP_DEFAULTS.tls,
  };

  try {
    const result = await withTimeout(connector.connect(config), 30000, 'Connection');
    const duration = Date.now() - startTime;
    
    if (result.success && result.connection) {
      const folders = await connector.listFolders();
      logResult({
        name: testName,
        status: 'PASS',
        duration,
        details: `Connected successfully. Folders: ${folders.length}`,
      });
      return { connector, connection: result.connection };
    } else {
      logResult({
        name: testName,
        status: 'FAIL',
        duration,
        error: result.error || 'Unknown error',
      });
      return null;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message.includes('timed out');
    logResult({
      name: testName,
      status: isTimeout ? 'TIMEOUT' : 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function testCount(connection: any): Promise<number> {
  const startTime = Date.now();
  const testName = 'API: /api/count';
  
  log(`Testing ${testName}...`);
  
  const fetcher = new EmailFetcher();
  const filter: FetchFilter = {
    folder: 'INBOX',
    subject: TEST_CONFIG.subject,
  };

  try {
    const count = await withTimeout(fetcher.count(connection, filter), 30000, 'Count');
    const duration = Date.now() - startTime;
    
    logResult({
      name: testName,
      status: 'PASS',
      duration,
      details: `Found ${count} emails matching filter`,
    });
    return count;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message.includes('timed out');
    logResult({
      name: testName,
      status: isTimeout ? 'TIMEOUT' : 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 0;
  }
}

async function testPreview(connection: any): Promise<string | null> {
  const startTime = Date.now();
  const testName = 'API: /api/preview';
  
  log(`Testing ${testName}...`);
  
  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const filter: FetchFilter = {
    folder: 'INBOX',
    subject: TEST_CONFIG.subject,
  };

  try {
    let emailContent: string | null = null;
    
    for await (const rawEmail of fetcher.fetch(connection, filter)) {
      const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
      emailContent = parsed.textContent || parser.stripHtml(parsed.htmlContent || '');
      
      const duration = Date.now() - startTime;
      logResult({
        name: testName,
        status: 'PASS',
        duration,
        details: `Preview: ${parsed.subject.substring(0, 50)}... (${emailContent.length} chars)`,
      });
      return emailContent;
    }
    
    const duration = Date.now() - startTime;
    logResult({
      name: testName,
      status: 'FAIL',
      duration,
      error: 'No emails found',
    });
    return null;
  } catch (error) {
    const duration = Date.now() - startTime;
    logResult({
      name: testName,
      status: 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function testValidate(connection: any): Promise<boolean> {
  const startTime = Date.now();
  const testName = 'API: /api/regex/validate';
  
  log(`Testing ${testName}...`);
  
  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const extractor = new RegexExtractor();
  
  const filter: FetchFilter = {
    folder: 'INBOX',
    subject: TEST_CONFIG.subject,
  };
  
  const pattern: ExtractionPattern = {
    name: 'test',
    pattern: TEST_CONFIG.pattern,
    flags: 'g',
  };

  try {
    const results: any[] = [];
    let processed = 0;
    const maxCount = 3;

    // Simulate the validation endpoint with timeout
    const validatePromise = (async () => {
      for await (const rawEmail of fetcher.fetch(connection, filter)) {
        if (processed >= maxCount) break;

        const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
        const result = extractor.extract(parsed, pattern, true);
        
        results.push({
          subject: parsed.subject,
          from: parsed.from,
          matchCount: result.matches.length,
          matches: result.matches.slice(0, 5), // Limit matches for display
        });
        processed++;
      }
      return results;
    })();

    const validationResults = await withTimeout(validatePromise, 60000, 'Validation');
    const duration = Date.now() - startTime;
    
    const successCount = validationResults.filter((r: any) => r.matchCount > 0).length;
    const totalMatches = validationResults.reduce((sum: number, r: any) => sum + r.matchCount, 0);
    
    logResult({
      name: testName,
      status: successCount > 0 ? 'PASS' : 'FAIL',
      duration,
      details: `Tested ${processed} emails, ${successCount} successful, ${totalMatches} total matches`,
    });
    
    // Show sample matches
    if (validationResults.length > 0 && validationResults[0].matches.length > 0) {
      console.log(`   Sample matches: ${validationResults[0].matches.slice(0, 3).map((m: any) => m.fullMatch).join(', ')}`);
    }
    
    return successCount > 0;
  } catch (error) {
    const duration = Date.now() - startTime;
    const isTimeout = error instanceof Error && error.message.includes('timed out');
    logResult({
      name: testName,
      status: isTimeout ? 'TIMEOUT' : 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

async function testExtract(connection: any): Promise<boolean> {
  const startTime = Date.now();
  const testName = 'API: /api/extract';
  
  log(`Testing ${testName}...`);
  
  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const extractor = new RegexExtractor();
  
  const filter: FetchFilter = {
    folder: 'INBOX',
    subject: TEST_CONFIG.subject,
  };
  
  const pattern: ExtractionPattern = {
    name: 'discount_code',
    pattern: TEST_CONFIG.pattern,
    flags: 'g',
  };

  try {
    let processed = 0;
    let totalMatches = 0;
    let errors = 0;
    const maxEmails = 10; // Limit for testing

    for await (const rawEmail of fetcher.fetch(connection, filter)) {
      if (processed >= maxEmails) break;
      
      try {
        const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
        const result = extractor.extract(parsed, pattern, true);
        totalMatches += result.matches.length;
        
        // Log progress
        if (processed % 5 === 0) {
          log(`  Progress: ${processed}/${maxEmails} emails, ${totalMatches} matches`);
        }
      } catch (error) {
        errors++;
      }
      processed++;
      
      // Add delay to simulate frontend behavior
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const duration = Date.now() - startTime;
    
    logResult({
      name: testName,
      status: totalMatches > 0 ? 'PASS' : 'FAIL',
      duration,
      details: `Processed ${processed} emails, ${totalMatches} matches, ${errors} errors`,
    });
    
    return totalMatches > 0;
  } catch (error) {
    const duration = Date.now() - startTime;
    logResult({
      name: testName,
      status: 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

async function testMailboxReopen(connection: any): Promise<boolean> {
  const startTime = Date.now();
  const testName = 'Mailbox Reopen Test';
  
  log(`Testing ${testName}...`);
  
  const fetcher = new EmailFetcher();
  const filter: FetchFilter = {
    folder: 'INBOX',
    subject: TEST_CONFIG.subject,
  };

  try {
    // First operation: count
    const count1 = await fetcher.count(connection, filter);
    log(`  First count: ${count1}`);
    
    // Second operation: count again (tests mailbox reopen)
    const count2 = await fetcher.count(connection, filter);
    log(`  Second count: ${count2}`);
    
    // Third operation: fetch (tests mailbox reopen after count)
    let fetchCount = 0;
    for await (const _ of fetcher.fetch(connection, filter)) {
      fetchCount++;
      if (fetchCount >= 3) break;
    }
    log(`  Fetch count: ${fetchCount}`);
    
    const duration = Date.now() - startTime;
    
    logResult({
      name: testName,
      status: 'PASS',
      duration,
      details: `Count1: ${count1}, Count2: ${count2}, Fetch: ${fetchCount}`,
    });
    
    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    logResult({
      name: testName,
      status: 'FAIL',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

async function runAllTests() {
  console.log('='.repeat(70));
  console.log('Frontend API Test Suite');
  console.log('='.repeat(70));
  console.log();
  console.log('Test Configuration:');
  console.log(`  Email: ${TEST_CONFIG.email}`);
  console.log(`  Subject Filter: ${TEST_CONFIG.subject}`);
  console.log(`  Pattern: ${TEST_CONFIG.pattern}`);
  console.log();
  console.log('-'.repeat(70));
  console.log();

  // Test 1: Connection
  const connectionResult = await testConnection();
  if (!connectionResult) {
    console.log('\n❌ Connection failed. Cannot continue with other tests.');
    printSummary();
    return;
  }

  const { connector, connection } = connectionResult;
  console.log();

  try {
    // Test 2: Count
    await testCount(connection);
    console.log();

    // Test 3: Preview
    await testPreview(connection);
    console.log();

    // Test 4: Mailbox Reopen (important for frontend)
    await testMailboxReopen(connection);
    console.log();

    // Test 5: Validate
    await testValidate(connection);
    console.log();

    // Test 6: Extract
    await testExtract(connection);
    console.log();

  } finally {
    // Cleanup
    await connector.disconnect();
    log('Disconnected from Yahoo Mail');
  }

  printSummary();
}

function printSummary() {
  console.log();
  console.log('='.repeat(70));
  console.log('Test Summary');
  console.log('='.repeat(70));
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const timeout = results.filter(r => r.status === 'TIMEOUT').length;
  
  console.log(`Total: ${results.length} tests`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️ Timeout: ${timeout}`);
  console.log();
  
  if (failed > 0 || timeout > 0) {
    console.log('Failed/Timeout Tests:');
    results.filter(r => r.status !== 'PASS').forEach(r => {
      console.log(`  - ${r.name}: ${r.status}`);
      if (r.error) {
        console.log(`    Error: ${r.error}`);
      }
    });
    console.log();
  }
  
  // Diagnose issues
  console.log('-'.repeat(70));
  console.log('Diagnosis:');
  console.log('-'.repeat(70));
  
  const timeoutTests = results.filter(r => r.status === 'TIMEOUT');
  if (timeoutTests.length > 0) {
    console.log('\n⚠️ TIMEOUT ISSUES DETECTED:');
    timeoutTests.forEach(t => {
      console.log(`  - ${t.name}`);
    });
    console.log('\nPossible causes:');
    console.log('  1. Network latency to Yahoo IMAP server');
    console.log('  2. Large number of emails matching filter');
    console.log('  3. Server-side rate limiting');
    console.log('\nRecommendations:');
    console.log('  1. Increase timeout values in server.ts');
    console.log('  2. Add more specific filters to reduce email count');
    console.log('  3. Implement pagination for large result sets');
  }
  
  const extractFailed = results.find(r => r.name.includes('extract') && r.status !== 'PASS');
  if (extractFailed) {
    console.log('\n⚠️ EXTRACTION ISSUES DETECTED:');
    console.log('  - Extraction test failed or timed out');
    console.log('\nPossible causes:');
    console.log('  1. Regex pattern not matching email content');
    console.log('  2. HTML stripping removing target content');
    console.log('  3. Email content encoding issues');
    console.log('\nRecommendations:');
    console.log('  1. Test regex pattern with preview content');
    console.log('  2. Try with stripHtml=false');
    console.log('  3. Check email content encoding');
  }
  
  const validateFailed = results.find(r => r.name.includes('validate') && r.status !== 'PASS');
  if (validateFailed) {
    console.log('\n⚠️ VALIDATION ISSUES DETECTED:');
    console.log('  - Validation test failed or timed out');
    console.log('\nPossible causes:');
    console.log('  1. Mailbox not properly closed between operations');
    console.log('  2. Connection state issues');
    console.log('  3. Timeout too short for validation');
    console.log('\nRecommendations:');
    console.log('  1. Check mailbox close/open logic in fetcher.ts');
    console.log('  2. Increase validation timeout');
    console.log('  3. Reduce number of emails to validate');
  }
  
  if (passed === results.length) {
    console.log('\n✅ All tests passed! Backend is working correctly.');
    console.log('\nIf frontend still has issues, check:');
    console.log('  1. Browser console for JavaScript errors');
    console.log('  2. Network tab for failed requests');
    console.log('  3. CORS configuration');
    console.log('  4. Frontend timeout settings');
  }
  
  console.log();
}

// Run tests
runAllTests().catch(console.error);
