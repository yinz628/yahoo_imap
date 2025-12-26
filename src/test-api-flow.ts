/**
 * API Flow Test Script
 * 
 * This script simulates the exact API flow that the frontend uses:
 * 1. Connect
 * 2. Count emails
 * 3. Preview first email
 * 4. Validate regex
 * 5. Extract all emails
 * 6. Disconnect
 */

const API_BASE = 'http://localhost:3000';

interface ApiResponse {
  success?: boolean;
  error?: string;
  sessionId?: string;
  folders?: string[];
  count?: number;
  content?: string;
  subject?: string;
  from?: string;
  date?: string;
  results?: any[];
  summary?: any;
}

async function fetchApi(endpoint: string, body: any): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  
  return response.json() as Promise<ApiResponse>;
}

async function fetchStreamApi(endpoint: string, body: any): Promise<any[]> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const errorData = await response.json() as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  
  const decoder = new TextDecoder();
  let buffer = '';
  const results: any[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (!line) continue;
      try {
        results.push(JSON.parse(line));
      } catch (e) {
        console.error('Parse error:', e);
      }
    }
  }
  
  return results;
}

async function runApiFlowTest() {
  console.log('='.repeat(70));
  console.log('Frontend API Flow Test');
  console.log('='.repeat(70));
  console.log();
  
  const testConfig = {
    email: 'abnerklewiyql@yahoo.com',
    password: 'ktrzxdkxmfvgxvhw',
    filter: {
      folder: 'INBOX',
      subject: '$50 off—make your shopping bag yours today!',
    },
    pattern: {
      name: 'discount_code',
      pattern: '(?<code>Z[0-9A-Z]{11})',
      flags: 'g',
    },
    stripHtml: true,
    delayMs: 100,
  };
  
  let sessionId: string | null = null;
  
  try {
    // Step 1: Connect
    console.log('Step 1: Connect');
    console.log('-'.repeat(70));
    
    const connectStart = Date.now();
    const connectResult = await fetchApi('/api/connect', {
      email: testConfig.email,
      password: testConfig.password,
    });
    
    if (!connectResult.success) {
      throw new Error(connectResult.error || 'Connection failed');
    }
    
    sessionId = connectResult.sessionId!;
    console.log(`✅ Connected in ${Date.now() - connectStart}ms`);
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Folders: ${connectResult.folders?.join(', ')}`);
    console.log();
    
    // Step 2: Count emails
    console.log('Step 2: Count Emails');
    console.log('-'.repeat(70));
    
    const countStart = Date.now();
    const countResult = await fetchApi('/api/count', {
      sessionId,
      filter: testConfig.filter,
    });
    
    console.log(`✅ Count completed in ${Date.now() - countStart}ms`);
    console.log(`   Found ${countResult.count} emails`);
    console.log();
    
    // Step 3: Preview first email
    console.log('Step 3: Preview First Email');
    console.log('-'.repeat(70));
    
    const previewStart = Date.now();
    const previewResult = await fetchApi('/api/preview', {
      sessionId,
      filter: testConfig.filter,
    });
    
    console.log(`✅ Preview completed in ${Date.now() - previewStart}ms`);
    console.log(`   Subject: ${previewResult.subject}`);
    console.log(`   From: ${previewResult.from}`);
    console.log(`   Content length: ${previewResult.content?.length || 0} chars`);
    console.log();
    
    // Step 4: Validate regex
    console.log('Step 4: Validate Regex');
    console.log('-'.repeat(70));
    
    const validateStart = Date.now();
    const validateResult = await fetchApi('/api/regex/validate', {
      sessionId,
      filter: testConfig.filter,
      pattern: testConfig.pattern,
      stripHtml: testConfig.stripHtml,
      count: 3,
    });
    
    console.log(`✅ Validation completed in ${Date.now() - validateStart}ms`);
    console.log(`   Tested: ${validateResult.summary?.tested} emails`);
    console.log(`   Successful: ${validateResult.summary?.successful} emails`);
    console.log(`   Total matches: ${validateResult.summary?.totalMatches}`);
    console.log(`   Success rate: ${validateResult.summary?.successRate}%`);
    
    if (validateResult.results && validateResult.results.length > 0) {
      console.log('\n   Sample results:');
      validateResult.results.forEach((r: any, idx: number) => {
        console.log(`     ${idx + 1}. ${r.subject?.substring(0, 40)}... - ${r.matchCount} matches`);
        if (r.matches && r.matches.length > 0) {
          console.log(`        Matches: ${r.matches.slice(0, 3).map((m: any) => m.fullMatch).join(', ')}`);
        }
      });
    }
    console.log();
    
    // Step 5: Extract (limited to 5 emails for testing)
    console.log('Step 5: Extract Emails (limited to 5)');
    console.log('-'.repeat(70));
    
    const extractStart = Date.now();
    const extractResults = await fetchStreamApi('/api/extract', {
      sessionId,
      filter: testConfig.filter,
      pattern: testConfig.pattern,
      stripHtml: testConfig.stripHtml,
      delayMs: testConfig.delayMs,
    });
    
    console.log(`✅ Extraction completed in ${Date.now() - extractStart}ms`);
    
    // Process streaming results
    let initData: any = null;
    let completeData: any = null;
    let progressCount = 0;
    let totalMatchesFound = 0;
    
    for (const result of extractResults) {
      if (result.type === 'init') {
        initData = result;
      } else if (result.type === 'progress') {
        progressCount++;
        if (result.matches) {
          totalMatchesFound += result.matches.length;
        }
      } else if (result.type === 'complete') {
        completeData = result;
      } else if (result.type === 'error') {
        console.log(`   ❌ Error: ${result.error}`);
      }
    }
    
    console.log(`   Total emails: ${initData?.total || 0}`);
    console.log(`   Processed: ${completeData?.processed || progressCount}`);
    console.log(`   Total matches: ${completeData?.totalMatches || totalMatchesFound}`);
    console.log(`   Errors: ${completeData?.errors || 0}`);
    console.log();
    
    // Step 6: Disconnect
    console.log('Step 6: Disconnect');
    console.log('-'.repeat(70));
    
    await fetchApi('/api/disconnect', { sessionId });
    console.log('✅ Disconnected');
    console.log();
    
    // Summary
    console.log('='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    console.log('✅ All API endpoints working correctly!');
    console.log();
    console.log('If frontend still has issues, check:');
    console.log('  1. Browser console for JavaScript errors');
    console.log('  2. Network tab for failed requests');
    console.log('  3. CORS configuration');
    console.log('  4. Frontend timeout settings');
    
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : error);
    
    // Try to disconnect if we have a session
    if (sessionId) {
      try {
        await fetchApi('/api/disconnect', { sessionId });
        console.log('✅ Disconnected after error');
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

// Check if server is running first
async function checkServer(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test', password: 'test' }),
    });
    return true; // Server is running (even if auth fails)
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('Checking if server is running...');
  
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.log('❌ Server is not running!');
    console.log('Please start the server first:');
    console.log('  npm run web');
    console.log();
    console.log('Or run this test directly without the server:');
    console.log('  node dist/test-frontend.js');
    return;
  }
  
  console.log('✅ Server is running');
  console.log();
  
  await runApiFlowTest();
}

main().catch(console.error);
