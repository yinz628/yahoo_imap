/**
 * Error classification and recovery strategy system
 * Categorizes IMAP connection errors and provides appropriate recovery strategies
 */

import { ErrorType, type RecoveryStrategy } from './types.js';

// Re-export ErrorType for backward compatibility
export { ErrorType };

/**
 * Error classifier - categorizes errors and suggests recovery strategies
 */
export class ErrorClassifier {
  /**
   * Classify error based on error message
   */
  classify(error: Error): ErrorType {
    const message = error.message.toLowerCase();
    
    // Authentication errors
    if (this.isAuthError(message)) {
      return ErrorType.AUTHENTICATION;
    }
    
    // Rate limit errors (Gmail specific)
    if (this.isRateLimitError(message)) {
      return ErrorType.RATE_LIMIT;
    }
    
    // Timeout errors
    if (this.isTimeoutError(message)) {
      return ErrorType.TIMEOUT;
    }
    
    // Network errors
    if (this.isNetworkError(message)) {
      return ErrorType.NETWORK;
    }
    
    // Server errors
    if (this.isServerError(message)) {
      return ErrorType.SERVER_ERROR;
    }
    
    return ErrorType.UNKNOWN;
  }

  /**
   * Get recovery strategy for error type
   */
  getRecoveryStrategy(errorType: ErrorType, attempt: number): RecoveryStrategy {
    switch (errorType) {
      case ErrorType.AUTHENTICATION:
        return {
          shouldRetry: false,
          delay: 0,
          maxAttempts: 0,
          userMessage: '认证失败，请检查邮箱地址和应用专用密码是否正确'
        };
        
      case ErrorType.RATE_LIMIT:
        return {
          shouldRetry: true,
          delay: 60000, // 1 minute for rate limit
          maxAttempts: 3,
          userMessage: 'Gmail 速率限制，等待1分钟后重试'
        };
        
      case ErrorType.NETWORK:
        return {
          shouldRetry: true,
          delay: Math.min(2000 * Math.pow(2, attempt), 30000),
          maxAttempts: 5,
          userMessage: '网络连接错误，正在重试...'
        };
        
      case ErrorType.TIMEOUT:
        return {
          shouldRetry: true,
          delay: Math.min(3000 * Math.pow(2, attempt), 60000),
          maxAttempts: 3,
          userMessage: '连接超时，正在重试...'
        };
        
      case ErrorType.SERVER_ERROR:
        return {
          shouldRetry: true,
          delay: 5000,
          maxAttempts: 3,
          userMessage: '服务器错误，正在重试...'
        };
        
      default:
        return {
          shouldRetry: true,
          delay: 3000,
          maxAttempts: 2,
          userMessage: '未知错误，正在重试...'
        };
    }
  }

  private isAuthError(message: string): boolean {
    return /auth|credential|password|login|authenticationfailed/i.test(message);
  }

  private isRateLimitError(message: string): boolean {
    return /rate limit|too many|quota|bandwidth|overquota/i.test(message);
  }

  private isTimeoutError(message: string): boolean {
    return /timeout|timed out/i.test(message);
  }

  private isNetworkError(message: string): boolean {
    return /network|connection|econnrefused|enotfound|socket/i.test(message);
  }

  private isServerError(message: string): boolean {
    return /server error|internal error|5\d\d|unavailable/i.test(message);
  }
}
