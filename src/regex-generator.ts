/**
 * Regex Generator Service
 * 
 * Provides functions for generating, escaping, and validating regex patterns
 * for discount code extraction workflow.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 4.4
 */

/**
 * Generated pattern result from target string
 */
export interface GeneratedPattern {
  literal: string;           // Escaped literal pattern that matches the target exactly
  suggestions: PatternSuggestion[];
}

/**
 * Pattern suggestion with description and confidence
 */
export interface PatternSuggestion {
  pattern: string;
  description: string;
  confidence: number;  // 0-1 scale
}

/**
 * Validation result for regex patterns
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Regex special characters that need escaping
 */
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escapes special regex characters in a string.
 * 
 * @param input - The string to escape
 * @returns The escaped string safe for use in a regex pattern
 * 
 * Requirements: 3.2
 */
export function escapeSpecialChars(input: string): string {
  return input.replace(REGEX_SPECIAL_CHARS, '\\$&');
}

/**
 * Generates a regex pattern from a target string.
 * Returns both a literal pattern and suggestions for generalized patterns.
 * 
 * @param target - The target string to generate a pattern for
 * @returns GeneratedPattern with literal match and suggestions
 * 
 * Requirements: 3.1, 3.3
 */
export function generateFromTarget(target: string): GeneratedPattern {
  const literal = escapeSpecialChars(target);
  const suggestions = suggestPatterns(target);
  
  return {
    literal,
    suggestions,
  };
}

/**
 * Suggests generalized regex patterns based on the target string.
 * Identifies common patterns like alphanumeric codes, numbers, etc.
 * Also detects context prefixes like "Use code:", "代码:", etc.
 * 
 * @param target - The target string to analyze
 * @returns Array of pattern suggestions
 * 
 * Requirements: 3.3
 */
export function suggestPatterns(target: string): PatternSuggestion[] {
  const suggestions: PatternSuggestion[] = [];
  const trimmedTarget = target.trim();
  
  // ========== Check for prefix patterns (e.g., "Use code: ABC123") ==========
  // Common prefixes in English and Chinese
  const prefixPatterns = [
    // English prefixes
    { regex: /^(?:use\s+)?code[:\s]+(.+)$/i, prefix: '(?:use\\s+)?code[:\\s]+', name: 'Use code' },
    { regex: /^promo(?:\s+code)?[:\s]+(.+)$/i, prefix: 'promo(?:\\s+code)?[:\\s]+', name: 'Promo code' },
    { regex: /^coupon(?:\s+code)?[:\s]+(.+)$/i, prefix: 'coupon(?:\\s+code)?[:\\s]+', name: 'Coupon code' },
    { regex: /^discount(?:\s+code)?[:\s]+(.+)$/i, prefix: 'discount(?:\\s+code)?[:\\s]+', name: 'Discount code' },
    { regex: /^voucher(?:\s+code)?[:\s]+(.+)$/i, prefix: 'voucher(?:\\s+code)?[:\\s]+', name: 'Voucher code' },
    { regex: /^your\s+code[:\s]+(.+)$/i, prefix: 'your\\s+code[:\\s]+', name: 'Your code' },
    { regex: /^redemption\s+code[:\s]+(.+)$/i, prefix: 'redemption\\s+code[:\\s]+', name: 'Redemption code' },
    { regex: /^gift\s+code[:\s]+(.+)$/i, prefix: 'gift\\s+code[:\\s]+', name: 'Gift code' },
    { regex: /^activation\s+code[:\s]+(.+)$/i, prefix: 'activation\\s+code[:\\s]+', name: 'Activation code' },
    { regex: /^verification\s+code[:\s]+(.+)$/i, prefix: 'verification\\s+code[:\\s]+', name: 'Verification code' },
    // Chinese prefixes
    { regex: /^(?:优惠码|折扣码|代码|兑换码|验证码|激活码|礼品码)[：:\s]+(.+)$/i, prefix: '(?:优惠码|折扣码|代码|兑换码|验证码|激活码|礼品码)[：:\\s]+', name: '中文优惠码' },
  ];
  
  for (const { regex, prefix, name } of prefixPatterns) {
    const match = trimmedTarget.match(regex);
    if (match && match[1]) {
      const codeValue = match[1].trim();
      const codeLen = codeValue.length;
      
      // Check if the code part is alphanumeric
      if (/^[A-Z0-9]+$/i.test(codeValue)) {
        // Add pattern with named capture group
        suggestions.push({
          pattern: `${prefix}(?<code>[A-Z0-9]{${codeLen}})`,
          description: `${name} 格式，精确 ${codeLen} 位代码 (带命名捕获组)`,
          confidence: 0.98,
        });
        
        // Add flexible length pattern
        const minLen = Math.max(codeLen - 2, 4);
        const maxLen = codeLen + 4;
        suggestions.push({
          pattern: `${prefix}(?<code>[A-Z0-9]{${minLen},${maxLen}})`,
          description: `${name} 格式，${minLen}-${maxLen} 位代码`,
          confidence: 0.95,
        });
        
        // Add generic pattern for any code after prefix
        suggestions.push({
          pattern: `${prefix}(?<code>[A-Z0-9]+)`,
          description: `${name} 格式，任意长度代码`,
          confidence: 0.85,
        });
      }
      
      // Return early since we found a prefix pattern
      if (suggestions.length > 0) {
        suggestions.sort((a, b) => b.confidence - a.confidence);
        return suggestions.slice(0, 6);
      }
    }
  }
  
  // ========== Universal code prefix pattern ==========
  // Pattern that matches multiple common prefixes
  suggestions.push({
    pattern: `(?:code|代码|优惠码|折扣码|兑换码|promo|coupon)[：:\\s]+(?<code>[A-Z0-9]{6,20})`,
    description: '通用优惠码格式 (支持中英文前缀，带命名捕获组)',
    confidence: 0.92,
  });
  
  // ========== Check for pure alphanumeric code ==========
  if (/^[A-Z0-9]+$/i.test(trimmedTarget)) {
    const len = trimmedTarget.length;
    
    // Named capture group pattern
    suggestions.push({
      pattern: `(?<code>[A-Z0-9]{${len}})`,
      description: `精确 ${len} 位字母数字代码 (带命名捕获组)`,
      confidence: 0.9,
    });
    
    // Exact length alphanumeric
    suggestions.push({
      pattern: `[A-Z0-9]{${len}}`,
      description: `精确匹配 ${len} 位字母数字组合`,
      confidence: 0.85,
    });
    
    // Flexible length alphanumeric with named group
    const minLen = Math.max(len - 2, 4);
    const maxLen = len + 4;
    suggestions.push({
      pattern: `(?<code>[A-Z0-9]{${minLen},${maxLen}})`,
      description: `${minLen}-${maxLen} 位代码 (带命名捕获组)`,
      confidence: 0.8,
    });
    
    // Check for specific patterns
    // Pattern: Letters followed by numbers (e.g., ABC123)
    if (/^[A-Z]+[0-9]+$/i.test(trimmedTarget)) {
      const letterMatch = trimmedTarget.match(/^[A-Z]+/i);
      const numberMatch = trimmedTarget.match(/[0-9]+$/);
      if (letterMatch && numberMatch) {
        suggestions.push({
          pattern: `(?<code>[A-Z]{${letterMatch[0].length}}[0-9]{${numberMatch[0].length}})`,
          description: `${letterMatch[0].length} 个字母后跟 ${numberMatch[0].length} 个数字`,
          confidence: 0.85,
        });
      }
    }
    
    // Pattern: Numbers followed by letters (e.g., 123ABC)
    if (/^[0-9]+[A-Z]+$/i.test(trimmedTarget)) {
      const numberMatch = trimmedTarget.match(/^[0-9]+/);
      const letterMatch = trimmedTarget.match(/[A-Z]+$/i);
      if (numberMatch && letterMatch) {
        suggestions.push({
          pattern: `(?<code>[0-9]{${numberMatch[0].length}}[A-Z]{${letterMatch[0].length}})`,
          description: `${numberMatch[0].length} 个数字后跟 ${letterMatch[0].length} 个字母`,
          confidence: 0.85,
        });
      }
    }
    
    // Pattern: Letters-Numbers-Letters (e.g., AB123CD)
    if (/^[A-Z]+[0-9]+[A-Z]+$/i.test(trimmedTarget)) {
      suggestions.push({
        pattern: `(?<code>[A-Z]+[0-9]+[A-Z]+)`,
        description: '字母-数字-字母 格式',
        confidence: 0.8,
      });
    }
  }
  
  // ========== Check for pure numeric ==========
  if (/^\d+$/.test(trimmedTarget)) {
    const len = trimmedTarget.length;
    suggestions.push({
      pattern: `(?<code>\\d{${len}})`,
      description: `精确 ${len} 位数字 (带命名捕获组)`,
      confidence: 0.9,
    });
    
    suggestions.push({
      pattern: `\\d{${len}}`,
      description: `精确匹配 ${len} 位数字`,
      confidence: 0.85,
    });
  }
  
  // ========== Check for hyphenated code (e.g., ABC-123-XYZ) ==========
  if (/^[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*$/i.test(trimmedTarget)) {
    const parts = trimmedTarget.split('-');
    const partPatterns = parts.map(p => `[A-Z0-9]{${p.length}}`);
    suggestions.push({
      pattern: `(?<code>${partPatterns.join('-')})`,
      description: `连字符分隔的代码 (${parts.length} 段，带命名捕获组)`,
      confidence: 0.9,
    });
    
    suggestions.push({
      pattern: `(?<code>[A-Z0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*)`,
      description: '连字符分隔的字母数字代码',
      confidence: 0.75,
    });
  }
  
  // ========== Check for percentage (e.g., 50%, 25.5%) ==========
  if (/^\d+(?:\.\d+)?%$/.test(trimmedTarget)) {
    suggestions.push({
      pattern: `(?<discount>\\d+(?:\\.\\d+)?%)`,
      description: '百分比数值 (带命名捕获组)',
      confidence: 0.95,
    });
  }
  
  // ========== Check for currency ==========
  if (/^[\$¥€£][\d,]+(?:\.\d{2})?$/.test(trimmedTarget)) {
    const currencySymbol = trimmedTarget[0];
    let currencyName = '金额';
    if (currencySymbol === '$') currencyName = '美元';
    else if (currencySymbol === '¥') currencyName = '人民币/日元';
    else if (currencySymbol === '€') currencyName = '欧元';
    else if (currencySymbol === '£') currencyName = '英镑';
    
    suggestions.push({
      pattern: `(?<amount>\\${currencySymbol}[\\d,]+(?:\\.\\d{2})?)`,
      description: `${currencyName}金额 (带命名捕获组)`,
      confidence: 0.9,
    });
  }
  
  // ========== Check for common discount code patterns with prefix ==========
  if (/^(SAVE|OFF|GET|CODE|PROMO|DISCOUNT|FREE|DEAL|SALE|VIP|NEW|FIRST|WELCOME)[A-Z0-9]+$/i.test(trimmedTarget)) {
    const prefixMatch = trimmedTarget.match(/^(SAVE|OFF|GET|CODE|PROMO|DISCOUNT|FREE|DEAL|SALE|VIP|NEW|FIRST|WELCOME)/i);
    if (prefixMatch) {
      const prefix = prefixMatch[0].toUpperCase();
      suggestions.push({
        pattern: `(?<code>${prefix}[A-Z0-9]+)`,
        description: `以 '${prefix}' 开头的优惠码`,
        confidence: 0.9,
      });
    }
  }
  
  // ========== Check for UUID-like pattern ==========
  if (/^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(trimmedTarget)) {
    suggestions.push({
      pattern: `(?<uuid>[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})`,
      description: 'UUID 格式 (带命名捕获组)',
      confidence: 0.95,
    });
  }
  
  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);
  
  // Limit to top 6 suggestions
  return suggestions.slice(0, 6);
}


/**
 * Validates a regex pattern string.
 * 
 * @param pattern - The regex pattern to validate
 * @param flags - Optional regex flags (default: '')
 * @returns ValidationResult indicating if the pattern is valid
 * 
 * Requirements: 3.5, 3.6, 4.4
 */
export function validateRegex(pattern: string, flags: string = ''): ValidationResult {
  // Check for empty pattern
  if (!pattern || pattern.trim() === '') {
    return {
      valid: false,
      error: 'Regex pattern cannot be empty',
    };
  }
  
  // Validate flags
  const validFlags = /^[gimsuy]*$/;
  if (flags && !validFlags.test(flags)) {
    // Find invalid flags
    const invalidFlags = flags.split('').filter(f => !'gimsuy'.includes(f));
    return {
      valid: false,
      error: `Invalid regex flags: ${invalidFlags.join(', ')}`,
    };
  }
  
  // Check for duplicate flags
  if (flags) {
    const flagSet = new Set(flags.split(''));
    if (flagSet.size !== flags.length) {
      return {
        valid: false,
        error: 'Duplicate regex flags are not allowed',
      };
    }
  }
  
  // Try to compile the regex
  try {
    new RegExp(pattern, flags);
    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      error: `Invalid regex: ${errorMessage}`,
    };
  }
}

/**
 * Tests a regex pattern against content and returns all matches.
 * 
 * @param pattern - The regex pattern to test
 * @param flags - Regex flags
 * @param content - The content to test against
 * @returns Array of matches with their positions
 * 
 * Requirements: 4.3
 */
export interface MatchResult {
  matches: string[];
  positions: number[];
}

export function testRegexMatch(pattern: string, flags: string, content: string): MatchResult {
  const validation = validateRegex(pattern, flags);
  if (!validation.valid) {
    return { matches: [], positions: [] };
  }
  
  const matches: string[] = [];
  const positions: number[] = [];
  const seenMatches = new Set<string>(); // Track unique matches
  
  try {
    // Ensure global flag for finding all matches
    const effectiveFlags = flags.includes('g') ? flags : flags + 'g';
    const regex = new RegExp(pattern, effectiveFlags);
    
    let match: RegExpExecArray | null;
    const maxMatches = 1000; // Safety limit
    let count = 0;
    const caseInsensitive = flags.includes('i');
    
    while ((match = regex.exec(content)) !== null && count < maxMatches) {
      const fullMatch = match[0];
      const matchKey = caseInsensitive ? fullMatch.toLowerCase() : fullMatch;
      
      // Only add if not seen before (deduplicate)
      if (!seenMatches.has(matchKey)) {
        seenMatches.add(matchKey);
        matches.push(fullMatch);
        positions.push(match.index);
      }
      count++;
      
      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  } catch {
    // Return empty results on error
  }
  
  return { matches, positions };
}
