import { readFile, writeFile } from 'fs/promises';
import type { ExtractorConfig, FetchFilter, ExtractionPattern, CSVExportOptions, ExcelExportOptions, DBExportOptions } from './types.js';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigManager {
  /**
   * Validates if the given object is a valid ExtractorConfig
   */
  validate(config: unknown): config is ExtractorConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }

    const c = config as Record<string, unknown>;

    // Validate imap
    if (!c.imap || typeof c.imap !== 'object') return false;
    const imap = c.imap as Record<string, unknown>;
    if (typeof imap.email !== 'string') return false;
    if (typeof imap.host !== 'string') return false;
    if (typeof imap.port !== 'number') return false;
    if (typeof imap.tls !== 'boolean') return false;

    // Validate filter
    if (!c.filter || typeof c.filter !== 'object') return false;
    const filter = c.filter as Record<string, unknown>;
    if (filter.folder !== undefined && typeof filter.folder !== 'string') return false;
    if (filter.dateFrom !== undefined && typeof filter.dateFrom !== 'string') return false;
    if (filter.dateTo !== undefined && typeof filter.dateTo !== 'string') return false;
    if (filter.sender !== undefined && typeof filter.sender !== 'string') return false;
    if (filter.subject !== undefined && typeof filter.subject !== 'string') return false;

    // Validate pattern
    if (!c.pattern || typeof c.pattern !== 'object') return false;
    const pattern = c.pattern as Record<string, unknown>;
    if (typeof pattern.name !== 'string') return false;
    if (typeof pattern.pattern !== 'string') return false;
    if (pattern.flags !== undefined && typeof pattern.flags !== 'string') return false;

    // Validate export
    if (!c.export || typeof c.export !== 'object') return false;
    const exp = c.export as Record<string, unknown>;
    if (!['csv', 'excel', 'sqlite'].includes(exp.format as string)) return false;
    if (!exp.options || typeof exp.options !== 'object') return false;

    return true;
  }


  /**
   * Serializes an ExtractorConfig to JSON string
   * Converts Date objects to ISO strings for JSON compatibility
   */
  serialize(config: ExtractorConfig): string {
    const serializable = {
      ...config,
      filter: {
        ...config.filter,
        dateFrom: config.filter.dateFrom?.toISOString(),
        dateTo: config.filter.dateTo?.toISOString(),
      },
    };
    return JSON.stringify(serializable, null, 2);
  }

  /**
   * Deserializes a JSON string to ExtractorConfig
   * Converts ISO date strings back to Date objects
   * Throws ConfigValidationError for invalid JSON or structure
   */
  deserialize(json: string): ExtractorConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      throw new ConfigValidationError(`Invalid JSON: ${message}`);
    }

    if (!this.validate(parsed)) {
      throw new ConfigValidationError('Invalid configuration structure: missing or invalid required fields');
    }

    const config = parsed as ExtractorConfig & { filter: { dateFrom?: string; dateTo?: string } };
    
    // Convert date strings back to Date objects
    const filter: FetchFilter = {
      ...config.filter,
      dateFrom: config.filter.dateFrom ? new Date(config.filter.dateFrom) : undefined,
      dateTo: config.filter.dateTo ? new Date(config.filter.dateTo) : undefined,
    };

    return {
      ...config,
      filter,
    };
  }

  /**
   * Saves an ExtractorConfig to a JSON file
   */
  async save(config: ExtractorConfig, path: string): Promise<void> {
    if (!this.validate(config)) {
      throw new ConfigValidationError('Cannot save invalid configuration');
    }
    const json = this.serialize(config);
    await writeFile(path, json, 'utf-8');
  }

  /**
   * Loads an ExtractorConfig from a JSON file
   */
  async load(path: string): Promise<ExtractorConfig> {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      throw new ConfigValidationError(`Failed to read config file: ${message}`);
    }
    return this.deserialize(content);
  }
}
