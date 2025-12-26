// Error Handling and Progress Utilities
import type { ProcessingError, ParsedEmail, ExtractionResult, ExtractionPattern } from './types.js';

/**
 * ErrorCollector collects and summarizes processing errors.
 * Allows batch processing to continue even when individual items fail.
 */
export class ErrorCollector {
  private _errors: ProcessingError[] = [];

  /**
   * Add a processing error to the collection.
   */
  add(error: ProcessingError): void {
    this._errors.push(error);
  }

  /**
   * Create and add an error from components.
   */
  addError(
    emailUid: number,
    stage: ProcessingError['stage'],
    error: Error
  ): void {
    this.add({
      emailUid,
      stage,
      error,
      timestamp: new Date(),
    });
  }

  /**
   * Get all collected errors.
   */
  get errors(): ProcessingError[] {
    return [...this._errors];
  }

  /**
   * Get the count of errors.
   */
  get count(): number {
    return this._errors.length;
  }

  /**
   * Check if any errors have been collected.
   */
  hasErrors(): boolean {
    return this._errors.length > 0;
  }

  /**
   * Clear all collected errors.
   */
  clear(): void {
    this._errors = [];
  }

  /**
   * Get a summary of errors by stage.
   */
  getSummary(): { total: number; byStage: Record<string, number> } {
    const byStage: Record<string, number> = {};

    for (const error of this._errors) {
      byStage[error.stage] = (byStage[error.stage] || 0) + 1;
    }

    return {
      total: this._errors.length,
      byStage,
    };
  }

  /**
   * Get errors for a specific stage.
   */
  getByStage(stage: ProcessingError['stage']): ProcessingError[] {
    return this._errors.filter(e => e.stage === stage);
  }

  /**
   * Format errors as a human-readable string.
   */
  formatSummary(): string {
    const summary = this.getSummary();
    if (summary.total === 0) {
      return 'No errors occurred.';
    }

    const lines = [`Total errors: ${summary.total}`];
    for (const [stage, count] of Object.entries(summary.byStage)) {
      lines.push(`  - ${stage}: ${count}`);
    }
    return lines.join('\n');
  }
}


/**
 * ProgressIndicator tracks and displays progress for batch operations.
 */
export class ProgressIndicator {
  private current: number = 0;
  private total: number;
  private startTime: Date;
  private onProgress?: (progress: ProgressInfo) => void;

  constructor(total: number, onProgress?: (progress: ProgressInfo) => void) {
    this.total = total;
    this.startTime = new Date();
    this.onProgress = onProgress;
  }

  /**
   * Increment progress by one.
   */
  increment(): void {
    this.current++;
    this.notifyProgress();
  }

  /**
   * Set the current progress value.
   */
  setCurrent(value: number): void {
    this.current = value;
    this.notifyProgress();
  }

  /**
   * Update the total count (useful when total is discovered during processing).
   */
  setTotal(value: number): void {
    this.total = value;
    this.notifyProgress();
  }

  /**
   * Get current progress information.
   */
  getProgress(): ProgressInfo {
    const elapsed = Date.now() - this.startTime.getTime();
    const percentage = this.total > 0 ? (this.current / this.total) * 100 : 0;
    const rate = elapsed > 0 ? (this.current / elapsed) * 1000 : 0;
    const remaining = rate > 0 ? (this.total - this.current) / rate : 0;

    return {
      current: this.current,
      total: this.total,
      percentage,
      elapsedMs: elapsed,
      estimatedRemainingMs: remaining * 1000,
      rate,
    };
  }

  /**
   * Format progress as a human-readable string.
   */
  format(): string {
    const info = this.getProgress();
    const pct = info.percentage.toFixed(1);
    return `${info.current}/${info.total} (${pct}%)`;
  }

  /**
   * Check if processing is complete.
   */
  isComplete(): boolean {
    return this.current >= this.total;
  }

  private notifyProgress(): void {
    if (this.onProgress) {
      this.onProgress(this.getProgress());
    }
  }
}

export interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  rate: number; // items per second
}

/**
 * ProcessingSummary contains the final results of a batch operation.
 */
export interface ProcessingSummary {
  totalProcessed: number;
  successfulExtractions: number;
  failures: number;
  elapsedMs: number;
  errors: ProcessingError[];
}

/**
 * BatchProcessor processes emails with error resilience.
 * Continues processing even when individual emails fail.
 */
export class BatchProcessor {
  private errorCollector: ErrorCollector;
  private progress: ProgressIndicator;

  constructor(total: number, onProgress?: (progress: ProgressInfo) => void) {
    this.errorCollector = new ErrorCollector();
    this.progress = new ProgressIndicator(total, onProgress);
  }

  /**
   * Process a single email with error handling.
   * Returns the result or null if processing failed.
   */
  async processEmail<T>(
    emailUid: number,
    stage: ProcessingError['stage'],
    processor: () => Promise<T> | T
  ): Promise<T | null> {
    try {
      const result = await processor();
      return result;
    } catch (error) {
      this.errorCollector.addError(
        emailUid,
        stage,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    } finally {
      this.progress.increment();
    }
  }

  /**
   * Get the error collector.
   */
  getErrorCollector(): ErrorCollector {
    return this.errorCollector;
  }

  /**
   * Get the progress indicator.
   */
  getProgress(): ProgressIndicator {
    return this.progress;
  }

  /**
   * Get a summary of the batch processing.
   */
  getSummary(): ProcessingSummary {
    const progressInfo = this.progress.getProgress();
    const errorSummary = this.errorCollector.getSummary();

    return {
      totalProcessed: progressInfo.current,
      successfulExtractions: progressInfo.current - errorSummary.total,
      failures: errorSummary.total,
      elapsedMs: progressInfo.elapsedMs,
      errors: this.errorCollector.errors,
    };
  }

  /**
   * Format the summary as a human-readable string.
   */
  formatSummary(): string {
    const summary = this.getSummary();
    const lines = [
      `Processing complete:`,
      `  Total processed: ${summary.totalProcessed}`,
      `  Successful: ${summary.successfulExtractions}`,
      `  Failures: ${summary.failures}`,
      `  Time: ${(summary.elapsedMs / 1000).toFixed(2)}s`,
    ];

    if (summary.failures > 0) {
      lines.push('');
      lines.push(this.errorCollector.formatSummary());
    }

    return lines.join('\n');
  }
}

/**
 * Process emails in batch with error resilience.
 * This is a convenience function that wraps BatchProcessor.
 * 
 * @param emails - Array of parsed emails to process
 * @param pattern - Extraction pattern to apply
 * @param extractor - Function to extract data from an email
 * @param onProgress - Optional progress callback
 * @returns Object with results and summary
 */
export async function processEmailsWithResilience(
  emails: ParsedEmail[],
  extractor: (email: ParsedEmail) => ExtractionResult,
  onProgress?: (progress: ProgressInfo) => void
): Promise<{
  results: ExtractionResult[];
  summary: ProcessingSummary;
}> {
  const processor = new BatchProcessor(emails.length, onProgress);
  const results: ExtractionResult[] = [];

  for (const email of emails) {
    const result = await processor.processEmail(
      email.uid,
      'extract',
      () => extractor(email)
    );

    if (result !== null) {
      results.push(result);
    }
  }

  return {
    results,
    summary: processor.getSummary(),
  };
}
