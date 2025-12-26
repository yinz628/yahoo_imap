/**
 * Mailbox State Test
 * 
 * This script tests the mailbox open/close behavior to diagnose
 * the issue with consecutive operations.
 */

import { IMAPConnector, YAHOO_IMAP_DEFAULTS } from './connector.js';
import { EmailFetcher } from './fetcher.js';
import { EmailParser } from './parser.js';
import { RegexExtractor } from './extractor.js';
import type { IMAPConfig, FetchFilter, ExtractionPattern } from './types.js';

const TEST_CONFIG = {
  email: 'abnerklewiyql@yahoo.com',
  password: 'ktrzxdkxmfvgxvhw',
  subject: '$50 off—make your shopping bag yours today!',
};

async function runTest() {
  console.log('='.repeat(70));
  console.log('Mailbox State Test');
  console.log('='.repeat(70));
  console.log();

  const connector = new IMAPConnector();
  const config: IMAPConfig = {
    email: TEST_CONFIG.email,
    password: TEST_CONFIG.password,
    host: YAHOO_IMAP_DEFAULTS.host,
    port: YAHOO_IMAP_DEFAULTS.port,
    tls: YAHOO_IMAP_DEFAULTS.tls,
  };

  try {
    // Connect
    console.log('Step 1: Connect');
    const result = await connector.connect(config);
    if (!result.success || !result.connection) {
      throw new Error(result.error || 'Connection failed');
    }
    console.log('✅ Connected');
    
    const connection = result.connection;
    const fetcher = new EmailFetcher();
    const parser = new EmailParser();
    const extractor = new RegexExtractor();
    
    const filter: FetchFilter = {
      folder: 'INBOX',
      subject: TEST_CONFIG.subject,
    };
    
    const pattern: ExtractionPattern = {
      name: 'test',
      pattern: '(?<code>Z[0-9A-Z]{11})',
      flags: 'g',
    };

    // Test 1: Count
    console.log('\nStep 2: Count');
    const count = await fetcher.count(connection, filter);
    console.log(`✅ Count: ${count}`);

    // Test 2: Preview (fetch first email)
    console.log('\nStep 3: Preview');
    let previewDone = false;
    console.log('  Starting preview fetch...');
    const previewGenerator = fetcher.fetch(connection, filter);
    console.log('  Generator created');
    
    try {
      for await (const rawEmail of previewGenerator) {
        console.log('  Got email from generator');
        const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
        console.log(`✅ Preview: ${parsed.subject.substring(0, 50)}...`);
        previewDone = true;
        console.log('  Breaking from loop...');
        break;
      }
    } catch (error) {
      console.error('  Preview error:', error);
    } finally {
      // Manually close the generator to ensure cleanup
      console.log('  Closing generator...');
      await previewGenerator.return(undefined);
      console.log('  Generator closed');
    }
    
    console.log('  Preview loop finished');
    
    if (!previewDone) {
      console.log('❌ No emails found for preview');
    }
    
    // Wait a bit for cleanup
    console.log('  Waiting for cleanup...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('  Cleanup done');

    // Test 3: Validate (fetch 3 emails)
    console.log('\nStep 4: Validate (3 emails)');
    let validateCount = 0;
    let totalMatches = 0;
    
    console.log('  Starting fetch...');
    for await (const rawEmail of fetcher.fetch(connection, filter)) {
      if (validateCount >= 3) break;
      
      console.log(`  Processing email ${validateCount + 1}...`);
      const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
      const result = extractor.extract(parsed, pattern, true);
      totalMatches += result.matches.length;
      console.log(`  ✅ Email ${validateCount + 1}: ${result.matches.length} matches`);
      validateCount++;
    }
    console.log(`✅ Validated ${validateCount} emails, ${totalMatches} total matches`);

    // Test 4: Extract (fetch 5 emails)
    console.log('\nStep 5: Extract (5 emails)');
    let extractCount = 0;
    let extractMatches = 0;
    
    for await (const rawEmail of fetcher.fetch(connection, filter)) {
      if (extractCount >= 5) break;
      
      const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
      const result = extractor.extract(parsed, pattern, true);
      extractMatches += result.matches.length;
      extractCount++;
    }
    console.log(`✅ Extracted ${extractCount} emails, ${extractMatches} total matches`);

    // Disconnect
    console.log('\nStep 6: Disconnect');
    await connector.disconnect();
    console.log('✅ Disconnected');

    console.log('\n' + '='.repeat(70));
    console.log('All tests passed!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    
    try {
      await connector.disconnect();
    } catch {
      // Ignore
    }
  }
}

runTest().catch(console.error);
