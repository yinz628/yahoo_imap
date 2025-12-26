/**
 * Rule Validation Service
 * 
 * Provides functions for validating extraction rules and testing regex matches.
 * 
 * Requirements: 4.3, 4.7, 4.8
 */

import { validateRegex } from './regex-generator.js';

/**
 * Validation result for rule validation
 */
export interface RuleValidationResult {
  valid: boolean;
  errors: RuleValidationError[];
}

/**
 * Individual validation error with field and message
 */
export interface RuleValidationError {
  field: string;
  message: string;
}

/**
 * Match result from regex testing
 */
export interface RegexMatchResult {
  matches: string[];
  positions: number[];
}

/**
 * Partial rule input for validation
 */
export interface PartialRule {
  patternName?: unknown;
  subjectPattern?: unknown;
  regexPattern?: unknown;
  regexFlags?: unknown;
  tags?: unknown;
}

/**
 * Validates an extraction rule structure.
 * Checks for required fields (patternName, subjectPattern, regexPattern),
 * validates field types, and returns clear error messages.
 * 
 * @param rule - The partial rule object to validate
 * @returns RuleValidationResult with valid flag and array of errors
 * 
 * Requirements: 4.7, 4.8
 */
export function validateRuleStructure(rule: PartialRule): RuleValidationResult {
  const errors: RuleValidationError[] = [];

  // Check if rule is an object
  if (!rule || typeof rule !== 'object') {
    errors.push({
      field: 'rule',
      message: 'Rule must be a non-null object',
    });
    return { valid: false, errors };
  }

  // Validate patternName - required, must be non-empty string
  if (rule.patternName === undefined || rule.patternName === null) {
    errors.push({
      field: 'patternName',
      message: 'Pattern name is required',
    });
  } else if (typeof rule.patternName !== 'string') {
    errors.push({
      field: 'patternName',
      message: 'Pattern name must be a string',
    });
  } else if (rule.patternName.trim() === '') {
    errors.push({
      field: 'patternName',
      message: 'Pattern name cannot be empty',
    });
  }

  // Validate subjectPattern - required, must be string
  if (rule.subjectPattern === undefined || rule.subjectPattern === null) {
    errors.push({
      field: 'subjectPattern',
      message: 'Subject pattern is required',
    });
  } else if (typeof rule.subjectPattern !== 'string') {
    errors.push({
      field: 'subjectPattern',
      message: 'Subject pattern must be a string',
    });
  }

  // Validate regexPattern - required, must be non-empty string, must be valid regex
  if (rule.regexPattern === undefined || rule.regexPattern === null) {
    errors.push({
      field: 'regexPattern',
      message: 'Regex pattern is required',
    });
  } else if (typeof rule.regexPattern !== 'string') {
    errors.push({
      field: 'regexPattern',
      message: 'Regex pattern must be a string',
    });
  } else if (rule.regexPattern.trim() === '') {
    errors.push({
      field: 'regexPattern',
      message: 'Regex pattern cannot be empty',
    });
  } else {
    // Validate regex syntax
    const flags = typeof rule.regexFlags === 'string' ? rule.regexFlags : '';
    const regexValidation = validateRegex(rule.regexPattern, flags);
    if (!regexValidation.valid) {
      errors.push({
        field: 'regexPattern',
        message: regexValidation.error || 'Invalid regex pattern',
      });
    }
  }

  // Validate regexFlags - optional, must be valid flags if provided
  if (rule.regexFlags !== undefined && rule.regexFlags !== null) {
    if (typeof rule.regexFlags !== 'string') {
      errors.push({
        field: 'regexFlags',
        message: 'Regex flags must be a string',
      });
    } else {
      const flagsValidation = validateRegex('test', rule.regexFlags);
      if (!flagsValidation.valid && flagsValidation.error?.includes('flag')) {
        errors.push({
          field: 'regexFlags',
          message: flagsValidation.error,
        });
      }
    }
  }

  // Validate tags - optional, must be array of strings if provided
  if (rule.tags !== undefined && rule.tags !== null) {
    if (!Array.isArray(rule.tags)) {
      errors.push({
        field: 'tags',
        message: 'Tags must be an array',
      });
    } else {
      const invalidTags = rule.tags.filter((tag: unknown) => typeof tag !== 'string');
      if (invalidTags.length > 0) {
        errors.push({
          field: 'tags',
          message: 'All tags must be strings',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Tests a regex pattern against content and returns all matches with positions.
 * 
 * @param pattern - The regex pattern to test
 * @param flags - Regex flags (e.g., 'gi')
 * @param content - The content to test against
 * @returns RegexMatchResult with matches array and positions array
 * 
 * Requirements: 4.3
 */
export function testRegexMatch(pattern: string, flags: string, content: string): RegexMatchResult {
  const result: RegexMatchResult = {
    matches: [],
    positions: [],
  };

  // Validate inputs
  if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
    return result;
  }

  if (typeof content !== 'string') {
    return result;
  }

  // Validate regex syntax first
  const validation = validateRegex(pattern, flags);
  if (!validation.valid) {
    return result;
  }

  try {
    // Ensure global flag for finding all matches
    const effectiveFlags = flags.includes('g') ? flags : flags + 'g';
    const regex = new RegExp(pattern, effectiveFlags);

    let match: RegExpExecArray | null;
    const maxMatches = 1000; // Safety limit to prevent infinite loops
    let count = 0;

    while ((match = regex.exec(content)) !== null && count < maxMatches) {
      result.matches.push(match[0]);
      result.positions.push(match.index);
      count++;

      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  } catch {
    // Return empty results on error
  }

  return result;
}

/**
 * Convenience function to get a formatted error message from validation result
 * 
 * @param result - The validation result
 * @returns Formatted error message string or empty string if valid
 */
export function getValidationErrorMessage(result: RuleValidationResult): string {
  if (result.valid) {
    return '';
  }
  
  return result.errors
    .map(err => `${err.field}: ${err.message}`)
    .join('; ');
}

/**
 * Checks if a specific field has an error in the validation result
 * 
 * @param result - The validation result
 * @param field - The field name to check
 * @returns true if the field has an error
 */
export function hasFieldError(result: RuleValidationResult, field: string): boolean {
  return result.errors.some(err => err.field === field);
}

/**
 * Gets the error message for a specific field
 * 
 * @param result - The validation result
 * @param field - The field name to get error for
 * @returns The error message or undefined if no error
 */
export function getFieldError(result: RuleValidationResult, field: string): string | undefined {
  const error = result.errors.find(err => err.field === field);
  return error?.message;
}
