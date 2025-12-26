/**
 * Extraction Patterns
 * 
 * Defines common regex patterns for extracting various types of data from emails.
 * These patterns are optimized for accuracy and can be used with the RegexExtractor.
 */

import type { ExtractionPattern } from './types.js';

/**
 * Discount code patterns - optimized for different formats
 */
export const DISCOUNT_CODE_PATTERNS = {
  /**
   * Standard discount code format
   * Matches: Z78J2DM2G5B6, ABC1234XYZ, etc.
   * Pattern: 1-2 letters + 2-4 digits + 0-3 letters
   */
  standard: {
    name: 'discount_code_standard',
    pattern: '(?<code>[A-Z]{1,2}[0-9]{2,4}[A-Z]{0,3})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Long format discount code
   * Matches: Z6ZWZR7N9CM5, ABCDEF123456, etc.
   * Pattern: 8-12 alphanumeric characters
   */
  long: {
    name: 'discount_code_long',
    pattern: '(?<code>[A-Z0-9]{8,12})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Special format discount code (Yahoo/Macy's style)
   * Matches: Z78J2DM2G5B6, Z6ZWZR7N9CM5, etc.
   * Pattern: Z followed by 11 alphanumeric characters
   */
  special: {
    name: 'discount_code_special',
    pattern: '(?<code>Z[0-9A-Z]{11})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Broad pattern for any alphanumeric code
   * Matches: Any 6-12 character alphanumeric sequence
   * Use with caution - may match non-discount codes
   */
  broad: {
    name: 'discount_code_broad',
    pattern: '(?<code>[A-Z0-9]{6,12})',
    flags: 'g',
  } as ExtractionPattern,
};

/**
 * Email-related patterns
 */
export const EMAIL_PATTERNS = {
  /**
   * Email address pattern
   * Matches: user@example.com, john.doe+tag@company.co.uk, etc.
   */
  email: {
    name: 'email_address',
    pattern: '(?<email>[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Phone number pattern (US format)
   * Matches: (123) 456-7890, 123-456-7890, 1234567890, etc.
   */
  phone: {
    name: 'phone_number',
    pattern: '(?<phone>\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4})',
    flags: 'g',
  } as ExtractionPattern,
};

/**
 * Price and currency patterns
 */
export const PRICE_PATTERNS = {
  /**
   * USD price pattern
   * Matches: $50, $1,234.56, $0.99, etc.
   */
  usd: {
    name: 'price_usd',
    pattern: '(?<price>\\$[0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})?)',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Percentage pattern
   * Matches: 50%, 25.5%, 100%, etc.
   */
  percentage: {
    name: 'percentage',
    pattern: '(?<percentage>[0-9]{1,3}(?:\\.[0-9]{1,2})?%)',
    flags: 'g',
  } as ExtractionPattern,
};

/**
 * Date and time patterns
 */
export const DATE_PATTERNS = {
  /**
   * ISO date format
   * Matches: 2025-12-24, 2025-01-01, etc.
   */
  iso: {
    name: 'date_iso',
    pattern: '(?<date>\\d{4}-\\d{2}-\\d{2})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * US date format
   * Matches: 12/24/2025, 1/1/2025, etc.
   */
  us: {
    name: 'date_us',
    pattern: '(?<date>\\d{1,2}/\\d{1,2}/\\d{4})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * European date format
   * Matches: 24-12-2025, 01-01-2025, etc.
   */
  eu: {
    name: 'date_eu',
    pattern: '(?<date>\\d{1,2}-\\d{1,2}-\\d{4})',
    flags: 'g',
  } as ExtractionPattern,
};

/**
 * Order and tracking patterns
 */
export const ORDER_PATTERNS = {
  /**
   * Order number pattern
   * Matches: ORD-123456, ORDER123456, #123456, etc.
   */
  orderNumber: {
    name: 'order_number',
    pattern: '(?<order>(?:ORD|ORDER|#)?[0-9]{6,10})',
    flags: 'g',
  } as ExtractionPattern,

  /**
   * Tracking number pattern
   * Matches: 1Z999AA10123456784, 9400111899223456789012, etc.
   */
  trackingNumber: {
    name: 'tracking_number',
    pattern: '(?<tracking>[0-9A-Z]{20,})',
    flags: 'g',
  } as ExtractionPattern,
};

/**
 * Get a pattern by name
 * 
 * @param name - Pattern name (e.g., 'discount_code_special')
 * @returns The pattern or undefined if not found
 */
export function getPattern(name: string): ExtractionPattern | undefined {
  const allPatterns = {
    ...DISCOUNT_CODE_PATTERNS,
    ...EMAIL_PATTERNS,
    ...PRICE_PATTERNS,
    ...DATE_PATTERNS,
    ...ORDER_PATTERNS,
  };

  return allPatterns[name as keyof typeof allPatterns];
}

/**
 * Get all available patterns
 * 
 * @returns Object containing all pattern categories
 */
export function getAllPatterns() {
  return {
    discountCodes: DISCOUNT_CODE_PATTERNS,
    emails: EMAIL_PATTERNS,
    prices: PRICE_PATTERNS,
    dates: DATE_PATTERNS,
    orders: ORDER_PATTERNS,
  };
}
