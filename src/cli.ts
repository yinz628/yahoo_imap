#!/usr/bin/env node
// CLI Interface for Yahoo Mail Extractor
import { Command } from 'commander';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { IMAPConnector, YAHOO_IMAP_DEFAULTS } from './connector.js';
import { EmailFetcher } from './fetcher.js';
import { EmailParser } from './parser.js';
import { RegexExtractor } from './extractor.js';
import { ConfigManager } from './config.js';
import { BatchProcessor, ProgressInfo } from './errors.js';
import { CSVExporter } from './exporters/csv.js';
import { ExcelExporter } from './exporters/excel.js';
import { SQLiteExporter } from './exporters/sqlite.js';
import type {
  IMAPConfig,
  FetchFilter,
  ExtractionPattern,
  ExtractorConfig,
  ParsedEmail,
  ExtractionResult,
} from './types.js';

const program = new Command();

program
  .name('yahoo-mail-extractor')
  .description('Yahoo Mail batch extraction tool using IMAP')
  .version('1.0.0');

// Extract command - main extraction functionality
program
  .command('extract')
  .description('Extract data from Yahoo Mail using regex patterns')
  .requiredOption('-e, --email <email>', 'Yahoo email address')
  .requiredOption('-p, --pattern <regex>', 'Regex pattern for extraction')
  .requiredOption('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Output format: csv, excel, sqlite', 'csv')
  .option('--folder <folder>', 'Mail folder to fetch from', 'INBOX')
  .option('--date-from <date>', 'Filter emails from date (ISO format)')
  .option('--date-to <date>', 'Filter emails to date (ISO format)')
  .option('--sender <sender>', 'Filter by sender email/name')
  .option('--subject <subject>', 'Filter by subject')
  .option('--pattern-name <name>', 'Name for the extraction pattern', 'default')
  .option('--pattern-flags <flags>', 'Regex flags (g, i, gi, etc.)', 'g')
  .option('--strip-html', 'Strip HTML tags before extraction', false)
  .option('--delimiter <char>', 'CSV delimiter character', ',')
  .option('--sheet-name <name>', 'Excel sheet name', 'Extracted Data')
  .option('--table-name <name>', 'SQLite table name', 'extractions')
  .action(async (options) => {
    await runExtract(options);
  });

// Config command group
const configCmd = program
  .command('config')
  .description('Manage extraction configurations');

// Config save subcommand
configCmd
  .command('save')
  .description('Save current configuration to a file')
  .requiredOption('-o, --output <path>', 'Output config file path')
  .requiredOption('-e, --email <email>', 'Yahoo email address')
  .requiredOption('-p, --pattern <regex>', 'Regex pattern for extraction')
  .requiredOption('--export-path <path>', 'Export output file path')
  .option('-f, --format <format>', 'Output format: csv, excel, sqlite', 'csv')
  .option('--folder <folder>', 'Mail folder to fetch from', 'INBOX')
  .option('--date-from <date>', 'Filter emails from date (ISO format)')
  .option('--date-to <date>', 'Filter emails to date (ISO format)')
  .option('--sender <sender>', 'Filter by sender email/name')
  .option('--subject <subject>', 'Filter by subject')
  .option('--pattern-name <name>', 'Name for the extraction pattern', 'default')
  .option('--pattern-flags <flags>', 'Regex flags (g, i, gi, etc.)', 'g')
  .option('--delimiter <char>', 'CSV delimiter character', ',')
  .option('--sheet-name <name>', 'Excel sheet name', 'Extracted Data')
  .option('--table-name <name>', 'SQLite table name', 'extractions')
  .action(async (options) => {
    await runConfigSave(options);
  });

// Config load subcommand
configCmd
  .command('load')
  .description('Load and run extraction from a config file')
  .requiredOption('-c, --config <path>', 'Config file path to load')
  .action(async (options) => {
    await runConfigLoad(options);
  });

/**
 * Prompt for password securely (hidden input)
 */
async function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // For Windows compatibility, we use a simple prompt
    // In production, consider using a library like 'read' for hidden input
    process.stdout.write(prompt);
    
    let password = '';
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    const onData = (char: string) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        console.log(); // New line after password
        rl.close();
        resolve(password);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(1);
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    };
    
    process.stdin.on('data', onData);
  });
}

/**
 * Display progress bar
 */
function displayProgress(info: ProgressInfo): void {
  const barWidth = 30;
  const filled = Math.round((info.percentage / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pct = info.percentage.toFixed(1).padStart(5);
  const rate = info.rate.toFixed(1);
  
  process.stdout.write(`\r[${bar}] ${pct}% | ${info.current}/${info.total} | ${rate}/s`);
}

/**
 * Build FetchFilter from CLI options
 */
function buildFilter(options: any): FetchFilter {
  const filter: FetchFilter = {};
  
  if (options.folder) {
    filter.folder = options.folder;
  }
  if (options.dateFrom) {
    filter.dateFrom = new Date(options.dateFrom);
  }
  if (options.dateTo) {
    filter.dateTo = new Date(options.dateTo);
  }
  if (options.sender) {
    filter.sender = options.sender;
  }
  if (options.subject) {
    filter.subject = options.subject;
  }
  
  return filter;
}

/**
 * Build ExtractionPattern from CLI options
 */
function buildPattern(options: any): ExtractionPattern {
  return {
    name: options.patternName || 'default',
    pattern: options.pattern,
    flags: options.patternFlags || 'g',
  };
}

/**
 * Run the extract command
 */
async function runExtract(options: any): Promise<void> {
  console.log('Yahoo Mail Extractor');
  console.log('====================\n');

  // Validate format
  const format = options.format.toLowerCase();
  if (!['csv', 'excel', 'sqlite'].includes(format)) {
    console.error(`Error: Invalid format "${format}". Use csv, excel, or sqlite.`);
    process.exit(1);
  }

  // Validate regex pattern
  try {
    new RegExp(options.pattern, options.patternFlags || 'g');
  } catch (e) {
    console.error(`Error: Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`);
    process.exit(1);
  }

  // Check output file overwrite
  if (existsSync(options.output)) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Output file "${options.output}" already exists. Overwrite? (y/N): `, resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'y') {
      console.log('Operation cancelled.');
      process.exit(0);
    }
  }

  // Prompt for password
  const password = await promptPassword('Enter Yahoo App Password: ');
  
  if (!password) {
    console.error('Error: Password is required.');
    process.exit(1);
  }

  const connector = new IMAPConnector();
  const fetcher = new EmailFetcher();
  const parser = new EmailParser();
  const extractor = new RegexExtractor();

  try {
    // Build configuration
    const imapConfig: IMAPConfig = {
      email: options.email,
      password,
      host: YAHOO_IMAP_DEFAULTS.host,
      port: YAHOO_IMAP_DEFAULTS.port,
      tls: YAHOO_IMAP_DEFAULTS.tls,
    };

    const filter = buildFilter(options);
    const pattern = buildPattern(options);

    // Connect to IMAP
    console.log(`Connecting to Yahoo Mail as ${options.email}...`);
    const connResult = await connector.connect(imapConfig);
    
    if (!connResult.success || !connResult.connection) {
      console.error(`Connection failed: ${connResult.error}`);
      process.exit(1);
    }
    
    console.log('Connected successfully!\n');

    // Count emails
    console.log('Counting emails...');
    const totalCount = await fetcher.count(connResult.connection, filter);
    console.log(`Found ${totalCount} emails matching filters.\n`);

    if (totalCount === 0) {
      console.log('No emails to process.');
      await connector.disconnect();
      process.exit(0);
    }

    // Process emails
    console.log('Processing emails...');
    const batchProcessor = new BatchProcessor(totalCount, displayProgress);
    const results: ExtractionResult[] = [];

    for await (const rawEmail of fetcher.fetch(connResult.connection, filter)) {
      const result = await batchProcessor.processEmail(
        rawEmail.uid,
        'extract',
        async () => {
          // Parse email
          const parsed = await parser.parse(Buffer.from(rawEmail.body), rawEmail.uid);
          
          // Extract data
          return extractor.extract(parsed, pattern, options.stripHtml);
        }
      );

      if (result) {
        results.push(result);
      }
    }

    console.log('\n'); // New line after progress bar

    // Disconnect
    await connector.disconnect();

    // Export results
    console.log(`Exporting to ${format.toUpperCase()}...`);
    await exportResults(results, format, options);
    
    console.log(`\nExported to: ${options.output}`);

    // Display summary
    const summary = batchProcessor.getSummary();
    console.log('\n' + batchProcessor.formatSummary());

    // Count total matches
    const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
    console.log(`\nTotal matches extracted: ${totalMatches}`);

  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
    await connector.disconnect();
    process.exit(1);
  }
}

/**
 * Export results to the specified format
 */
async function exportResults(results: ExtractionResult[], format: string, options: any): Promise<void> {
  switch (format) {
    case 'csv': {
      const exporter = new CSVExporter();
      await exporter.export(results, {
        outputPath: options.output,
        delimiter: options.delimiter || ',',
        includeHeaders: true,
      });
      break;
    }
    case 'excel': {
      const exporter = new ExcelExporter();
      await exporter.export(results, {
        outputPath: options.output,
        sheetName: options.sheetName || 'Extracted Data',
      });
      break;
    }
    case 'sqlite': {
      const exporter = new SQLiteExporter();
      await exporter.export(results, {
        dbPath: options.output,
        tableName: options.tableName || 'extractions',
      });
      break;
    }
  }
}

/**
 * Run the config save command
 */
async function runConfigSave(options: any): Promise<void> {
  console.log('Saving configuration...\n');

  // Validate format
  const format = options.format.toLowerCase();
  if (!['csv', 'excel', 'sqlite'].includes(format)) {
    console.error(`Error: Invalid format "${format}". Use csv, excel, or sqlite.`);
    process.exit(1);
  }

  // Validate regex pattern
  try {
    new RegExp(options.pattern, options.patternFlags || 'g');
  } catch (e) {
    console.error(`Error: Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`);
    process.exit(1);
  }

  const filter = buildFilter(options);
  const pattern = buildPattern(options);

  // Build export options based on format
  let exportOptions: any;
  switch (format) {
    case 'csv':
      exportOptions = {
        outputPath: options.exportPath,
        delimiter: options.delimiter || ',',
        includeHeaders: true,
      };
      break;
    case 'excel':
      exportOptions = {
        outputPath: options.exportPath,
        sheetName: options.sheetName || 'Extracted Data',
      };
      break;
    case 'sqlite':
      exportOptions = {
        dbPath: options.exportPath,
        tableName: options.tableName || 'extractions',
      };
      break;
  }

  const config: ExtractorConfig = {
    imap: {
      email: options.email,
      host: YAHOO_IMAP_DEFAULTS.host,
      port: YAHOO_IMAP_DEFAULTS.port,
      tls: YAHOO_IMAP_DEFAULTS.tls,
    },
    filter,
    pattern,
    export: {
      format: format as 'csv' | 'excel' | 'sqlite',
      options: exportOptions,
    },
  };

  const configManager = new ConfigManager();
  
  try {
    await configManager.save(config, options.output);
    console.log(`Configuration saved to: ${options.output}`);
    console.log('\nNote: Password is not saved in the config file for security.');
    console.log('You will be prompted for it when loading the config.');
  } catch (error) {
    console.error(`Error saving config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

/**
 * Run the config load command
 */
async function runConfigLoad(options: any): Promise<void> {
  console.log('Loading configuration...\n');

  const configManager = new ConfigManager();
  
  let config: ExtractorConfig;
  try {
    config = await configManager.load(options.config);
    console.log(`Loaded config from: ${options.config}`);
  } catch (error) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }

  // Display loaded config
  console.log('\nConfiguration:');
  console.log(`  Email: ${config.imap.email}`);
  console.log(`  Folder: ${config.filter.folder || 'INBOX'}`);
  console.log(`  Pattern: ${config.pattern.pattern}`);
  console.log(`  Format: ${config.export.format}`);
  
  if (config.filter.dateFrom) {
    console.log(`  Date from: ${config.filter.dateFrom.toISOString()}`);
  }
  if (config.filter.dateTo) {
    console.log(`  Date to: ${config.filter.dateTo.toISOString()}`);
  }
  if (config.filter.sender) {
    console.log(`  Sender: ${config.filter.sender}`);
  }
  if (config.filter.subject) {
    console.log(`  Subject: ${config.filter.subject}`);
  }

  console.log('');

  // Get output path from config
  let outputPath: string;
  if ('outputPath' in config.export.options) {
    outputPath = config.export.options.outputPath;
  } else if ('dbPath' in config.export.options) {
    outputPath = config.export.options.dbPath;
  } else {
    console.error('Error: No output path found in config.');
    process.exit(1);
  }

  // Build options object for runExtract
  const extractOptions = {
    email: config.imap.email,
    pattern: config.pattern.pattern,
    output: outputPath,
    format: config.export.format,
    folder: config.filter.folder,
    dateFrom: config.filter.dateFrom?.toISOString(),
    dateTo: config.filter.dateTo?.toISOString(),
    sender: config.filter.sender,
    subject: config.filter.subject,
    patternName: config.pattern.name,
    patternFlags: config.pattern.flags,
    stripHtml: false,
    delimiter: 'delimiter' in config.export.options ? config.export.options.delimiter : ',',
    sheetName: 'sheetName' in config.export.options ? config.export.options.sheetName : 'Extracted Data',
    tableName: 'tableName' in config.export.options ? config.export.options.tableName : 'extractions',
  };

  // Run extraction with loaded config
  await runExtract(extractOptions);
}

// Parse and execute
program.parse();
