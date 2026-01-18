# 邮件连接稳定性改进设计文档

## 概述

本设计文档描述了在现有连接机制基础上，针对所有邮件提供商（Yahoo、Gmail 等）的 IMAP 连接稳定性增量改进方案。项目已经具备完善的基础连接管理功能（重试、重连、批量处理），本次改进通过**统一的机制和提供商特定的配置参数**，显著提升所有邮件服务的连接成功率和稳定性。

### 设计原则

1. **统一机制**: 所有提供商使用相同的连接管理机制（重试、Keep-Alive、错误分类等）
2. **差异化配置**: 根据不同提供商的特点（响应速度、稳定性）使用不同的配置参数
3. **增量改进**: 在现有代码基础上优化，不进行大规模重构
4. **向后兼容**: 保持现有 API 接口不变，默认行为不变

### 适用范围

- ✅ **Yahoo Mail**: 优化配置（30秒超时、3次重试、5分钟 Keep-Alive）
- ✅ **Gmail**: 优化配置（60秒超时、5次重试、3分钟 Keep-Alive）
- ✅ **其他 IMAP 服务**: 使用默认配置（可自定义）

## 现有架构回顾

### 当前实现状态

项目已经实现了以下核心功能：

1. **IMAPConnector** (src/connector.ts)
   - ✅ 连接重试机制（3次，固定2秒延迟）
   - ✅ 健康检查（NOOP命令）
   - ✅ 自动重连（ensureConnected）
   - ✅ 认证错误识别

2. **Server 会话管理** (src/server.ts)
   - ✅ ensureSessionConnected（每次操作前检查）
   - ✅ 提取过程批量处理（每批20封）
   - ✅ 批量重试（每批3次）
   - ✅ 智能重连（最多5次）

3. **EmailFetcher** (src/fetcher.ts)
   - ✅ 邮箱关闭超时处理（5秒）
   - ✅ 批量获取邮件

### 改进架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 UI 层                            │
│  - 连接进度显示（增强：渐进式反馈）                          │
│  - 错误提示和建议（增强：更详细的错误信息）                  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    API 服务层                                │
│  - /api/connect (增强：Gmail超时优化)                        │
│  - ensureSessionConnected (增强：指数退避)                   │
│  - /api/extract (增强：指数退避重连)                         │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 IMAP 连接层（增强）                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  IMAPConnector (增强版)                              │  │
│  │  - ✅ 现有：基础重试、健康检查、自动重连              │  │
│  │  - 🆕 新增：指数退避重试                             │  │
│  │  - 🆕 新增：Gmail特定超时配置                        │  │
│  │  - 🆕 新增：完善的错误分类                           │  │
│  │  - 🆕 新增：Keep-alive保活机制                       │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ErrorClassifier (新增)                              │  │
│  │  - 错误类型分类                                      │  │
│  │  - 恢复策略规划                                      │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  ImapFlow 库                                 │
│  - 底层 IMAP 协议实现                                        │
└─────────────────────────────────────────────────────────────┘
```

**注意**：本次改进采用**增量式**方案，在现有代码基础上优化，不进行大规模重构。

## 组件和接口

### 阶段 1: 基础增强（高优先级）

#### 1.1 提供商特定超时配置

**修改位置**: `src/connector.ts` - `DEFAULT_CONNECTION_OPTIONS`

**现有代码**:
```typescript
const DEFAULT_CONNECTION_OPTIONS: Required<ConnectionOptions> = {
  maxRetries: 3,
  retryDelay: 2000,
  connectionTimeout: 30000,  // 所有提供商统一30秒
  idleTimeout: 300000,
};
```

**改进方案**:
```typescript
// 新增：提供商特定配置
interface ProviderConnectionOptions {
  yahoo: Required<ConnectionOptions>;
  gmail: Required<ConnectionOptions>;
  default: Required<ConnectionOptions>;  // 🆕 其他提供商的默认配置
}

const PROVIDER_CONNECTION_OPTIONS: ProviderConnectionOptions = {
  yahoo: {
    maxRetries: 3,
    retryDelay: 2000,
    retryDelayMax: 10000,          // 最大延迟 10秒
    connectionTimeout: 30000,      // Yahoo: 30秒（通常很快）
    operationTimeout: 20000,       // 操作超时: 20秒
    idleTimeout: 300000,           // 5分钟
  },
  gmail: {
    maxRetries: 5,                 // Gmail: 更多重试次数
    retryDelay: 2000,              // 基础延迟（将使用指数退避）
    retryDelayMax: 30000,          // 最大延迟 30秒
    connectionTimeout: 60000,      // Gmail: 60秒（2倍于Yahoo）
    operationTimeout: 45000,       // 操作超时: 45秒
    idleTimeout: 180000,           // 3分钟（Gmail更容易断开）
  },
  default: {
    maxRetries: 3,
    retryDelay: 2000,
    retryDelayMax: 15000,          // 默认: 15秒
    connectionTimeout: 40000,      // 默认: 40秒
    operationTimeout: 30000,       // 默认: 30秒
    idleTimeout: 240000,           // 默认: 4分钟
  },
};

// 修改构造函数，接受提供商参数
constructor(provider: EmailProvider = 'yahoo', options?: Partial<ConnectionOptions>) {
  const defaultOptions = PROVIDER_CONNECTION_OPTIONS[provider] || PROVIDER_CONNECTION_OPTIONS.default;
  this.options = { ...defaultOptions, ...options };
  this.provider = provider;
}
```

**影响范围**:
- `src/server.ts` - `/api/connect` 端点需要传递 provider
- `src/server.ts` - `ensureSessionConnected` 函数需要使用正确的 provider

**优势**:
- ✅ 所有提供商都受益于优化的配置
- ✅ Yahoo 用户也获得更好的连接体验
- ✅ 易于添加新的邮件提供商支持

#### 1.2 指数退避重试策略

**修改位置**: `src/connector.ts` - `connect()` 方法

**现有代码**:
```typescript
// Wait before retry (except on last attempt)
if (attempt < this.options.maxRetries) {
  console.log(`[IMAPConnector] Connection attempt ${attempt} failed, retrying in ${this.options.retryDelay}ms...`);
  await this.delay(this.options.retryDelay);  // 固定延迟
}
```

**改进方案**:
```typescript
/**
 * Calculate retry delay using exponential backoff
 * Formula: min(baseDelay * 2^(attempt-1), maxDelay)
 */
private calculateRetryDelay(attempt: number): number {
  const baseDelay = this.options.retryDelay;
  const maxDelay = this.options.retryDelayMax || 30000; // 最大30秒
  const delay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, maxDelay);
}

// 在 connect() 方法中使用
if (attempt < this.options.maxRetries) {
  const delay = this.calculateRetryDelay(attempt);
  console.log(`[IMAPConnector] Connection attempt ${attempt} failed, retrying in ${delay}ms...`);
  await this.delay(delay);
}
```

**新增配置项**:
```typescript
interface ConnectionOptions {
  maxRetries?: number;
  retryDelay?: number;
  retryDelayMax?: number;        // 🆕 新增：最大延迟
  connectionTimeout?: number;
  operationTimeout?: number;     // 🆕 新增：操作超时
  idleTimeout?: number;
}
```

#### 1.3 完善的错误分类

**新增文件**: `src/error-classifier.ts`

```typescript
/**
 * Error types for classification
 */
export enum ErrorType {
  AUTHENTICATION = 'authentication',    // 认证错误，不可重试
  NETWORK = 'network',                  // 网络错误，可重试
  TIMEOUT = 'timeout',                  // 超时错误，可重试
  RATE_LIMIT = 'rate_limit',           // 速率限制，需延迟重试
  SERVER_ERROR = 'server_error',       // 服务器错误，可重试
  UNKNOWN = 'unknown'                   // 未知错误
}

/**
 * Recovery strategy for different error types
 */
export interface RecoveryStrategy {
  shouldRetry: boolean;
  delay: number;
  maxAttempts: number;
  userMessage: string;
}

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
    return /auth|credential|password|login|AUTHENTICATIONFAILED/i.test(message);
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
```

**集成到 IMAPConnector**:
```typescript
import { ErrorClassifier, ErrorType } from './error-classifier.js';

export class IMAPConnector {
  private errorClassifier: ErrorClassifier;
  
  constructor(provider: EmailProvider = 'yahoo', options?: Partial<ConnectionOptions>) {
    // ... existing code ...
    this.errorClassifier = new ErrorClassifier();
  }

  async connect(config: IMAPConfig): Promise<ConnectionResult> {
    this.config = config;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        const result = await this.attemptConnect(config, attempt);
        if (result.success) {
          this.connectionHealthy = true;
          this.lastActivity = Date.now();
          return result;
        }
        lastError = new Error(result.error || 'Unknown error');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
      }

      // Classify error and get recovery strategy
      if (lastError) {
        const errorType = this.errorClassifier.classify(lastError);
        const strategy = this.errorClassifier.getRecoveryStrategy(errorType, attempt);
        
        // Don't retry if strategy says so
        if (!strategy.shouldRetry) {
          return {
            success: false,
            error: `${lastError.message}. ${strategy.userMessage}`,
          };
        }
        
        // Check if we've exceeded max attempts for this error type
        if (attempt >= strategy.maxAttempts) {
          return {
            success: false,
            error: `${lastError.message}. 已达到最大重试次数。`,
          };
        }
        
        // Wait before retry
        if (attempt < this.options.maxRetries) {
          console.log(`[IMAPConnector] ${strategy.userMessage} (尝试 ${attempt}/${strategy.maxAttempts})`);
          await this.delay(strategy.delay);
        }
      }
    }

    return {
      success: false,
      error: `连接失败: ${lastError?.message || 'Unknown error'}`,
    };
  }
}
```

### 阶段 2: 连接管理增强（中优先级）

#### 2.1 Keep-Alive 保活机制（适用于所有提供商）

**修改位置**: `src/connector.ts` - `IMAPConnector` 类

**设计说明**:
- 所有提供商都使用 Keep-Alive 机制
- 根据提供商特点使用不同的间隔时间
- Yahoo: 5分钟（更稳定，间隔更长）
- Gmail: 3分钟（更容易断开，间隔更短）
- 其他: 4分钟（默认值）

**新增方法**:
```typescript
export class IMAPConnector {
  private keepAliveTimer?: NodeJS.Timeout;
  private keepAliveInterval: number = 180000; // 3 minutes

  /**
   * Start keep-alive mechanism
   * Sends NOOP command every 3 minutes to keep connection alive
   */
  startKeepAlive(): void {
    this.stopKeepAlive(); // Clear any existing timer
    
    this.keepAliveTimer = setInterval(async () => {
      if (this.client && this.connectionHealthy) {
        try {
          await this.client.noop();
          this.lastActivity = Date.now();
          console.log('[IMAPConnector] Keep-alive NOOP sent');
        } catch (error) {
          console.error('[IMAPConnector] Keep-alive failed:', error);
          this.connectionHealthy = false;
        }
      }
    }, this.keepAliveInterval);
  }

  /**
   * Stop keep-alive mechanism
   */
  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * Modified disconnect to stop keep-alive
   */
  async disconnect(): Promise<void> {
    this.stopKeepAlive(); // 🆕 Stop keep-alive
    this.connectionHealthy = false;
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignore errors during disconnect
      } finally {
        this.client = null;
        this.config = null;
      }
    }
  }
}
```

**集成到连接流程**:
```typescript
async connect(config: IMAPConfig): Promise<ConnectionResult> {
  // ... existing connection code ...
  
  if (result.success) {
    this.connectionHealthy = true;
    this.lastActivity = Date.now();
    this.startKeepAlive(); // 🆕 Start keep-alive after successful connection
    return result;
  }
  
  // ... rest of code ...
}
```

#### 2.2 提取过程指数退避重连

**修改位置**: `src/server.ts` - `/api/extract` 端点

**现有代码**:
```typescript
// Wait a bit before reconnecting
await new Promise(resolve => setTimeout(resolve, 2000)); // 固定2秒
```

**改进方案**:
```typescript
// Helper function to reconnect with exponential backoff
const reconnect = async (attempt: number): Promise<boolean> => {
  console.log(`[Extract] Attempting to reconnect (attempt ${attempt})...`);
  const imapSettings = getIMAPSettings(session!.provider);
  
  // First try to disconnect cleanly
  try {
    await session!.connector.disconnect();
  } catch {
    // Ignore disconnect errors
  }
  
  // Calculate delay using exponential backoff
  const baseDelay = 2000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  
  console.log(`[Extract] Waiting ${delay}ms before reconnect...`);
  await new Promise(resolve => setTimeout(resolve, delay));
  
  const result = await session!.connector.connect({
    email: session!.email,
    password: session!.password,
    host: imapSettings.host,
    port: imapSettings.port,
    tls: imapSettings.tls,
  });

  if (result.success && result.connection) {
    session!.connection = result.connection;
    session!.lastActivity = Date.now();
    console.log(`[Extract] Reconnected successfully`);
    return true;
  } else {
    console.log(`[Extract] Reconnection failed: ${result.error}`);
    return false;
  }
};

// 在批量处理循环中使用
for (let attempt = 0; attempt < 3 && !fetchSuccess; attempt++) {
  try {
    session.lastActivity = Date.now();
    batchEmails = await fetcher.fetchByUIDs(session.connection, fetchFilter.folder || 'INBOX', batchUIDs);
    fetchSuccess = true;
    reconnectAttempts = 0; // Reset on success
  } catch (error) {
    console.error(`[Extract] Batch fetch attempt ${attempt + 1} failed:`, error);
    
    if (attempt < 2) {
      reconnectAttempts++;
      if (reconnectAttempts > maxReconnectAttempts) {
        throw new Error(`Max reconnect attempts (${maxReconnectAttempts}) reached`);
      }
      
      // 🆕 Use exponential backoff
      if (!await reconnect(reconnectAttempts)) {
        throw new Error('Failed to reconnect to mail server');
      }
    }
  }
}
```

#### 2.3 渐进式连接反馈（适用于所有提供商）

**修改位置**: `public/index.html` - `connect()` 函数

**设计说明**:
- 所有提供商都提供渐进式反馈
- 根据提供商特点调整提示内容和超时时间

**改进方案**:
```typescript
async function connect() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  if (!email || !password) {
    showStatus('connectionStatus', '请输入邮箱和密码', 'error');
    return;
  }

  // 🆕 检测提供商类型
  const isGmail = email.includes('gmail') || email.includes('googlemail');
  const isYahoo = email.includes('yahoo') || email.includes('ymail') || email.includes('rocketmail');

  showStatus('connectionStatus', '正在连接...', 'info');
  
  // 🆕 Progressive feedback timers - 所有提供商都适用
  const feedback10s = setTimeout(() => {
    showStatus('connectionStatus', '⏳ 连接较慢，请稍候...', 'info');
  }, 10000);
  
  const feedback30s = setTimeout(() => {
    if (isGmail) {
      showStatus('connectionStatus', '⏳ Gmail 响应缓慢，继续等待中...', 'info');
    } else if (isYahoo) {
      showStatus('connectionStatus', '⏳ Yahoo 连接时间较长，请耐心等待...', 'info');
    } else {
      showStatus('connectionStatus', '⏳ 连接时间较长，请耐心等待...', 'info');
    }
  }, 30000);
  
  try {
    const controller = new AbortController();
    // 🆕 Provider-specific timeout
    let timeout;
    if (isGmail) {
      timeout = 90000; // Gmail: 90秒
    } else if (isYahoo) {
      timeout = 45000; // Yahoo: 45秒
    } else {
      timeout = 60000; // 其他: 60秒
    }
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const startTime = Date.now();
    
    const res = await apiRequest('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    clearTimeout(feedback10s);
    clearTimeout(feedback30s);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!res.ok) {
      const error = await res.json();
      showStatus('connectionStatus', `连接失败: ${error.error || 'Unknown error'}`, 'error');
      return;
    }
    
    const data = await res.json();
    
    if (data.success) {
      sessionId = data.sessionId;
      document.getElementById('connectionForm').classList.add('hidden');
      document.getElementById('connectedInfo').classList.remove('hidden');
      document.getElementById('connectedEmail').textContent = email;
      
      const virtualFolders = ['[Gmail]', '[Google Mail]'];
      const validFolders = data.folders.filter(f => !virtualFolders.includes(f));
      
      const folderSelect = document.getElementById('folder');
      folderSelect.innerHTML = validFolders.map(f => `<option value="${f}">${f}</option>`).join('');
      
      // 🆕 Show connection time - 所有提供商
      showStatus('connectionStatus', `✅ 连接成功！(耗时 ${elapsed} 秒)`, 'success');
      
      if (currentModule === 'email-management') {
        initEmailManagement();
      }
    } else {
      showStatus('connectionStatus', `连接失败: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    clearTimeout(feedback10s);
    clearTimeout(feedback30s);
    
    if (e.name === 'AbortError') {
      // 🆕 Provider-specific timeout message
      let timeoutMsg;
      if (isGmail) {
        timeoutMsg = '❌ 连接超时 (90 秒)。Gmail 连接较慢，请检查：\n1. 网络连接是否稳定\n2. 是否使用了应用专用密码\n3. 稍后重试';
      } else if (isYahoo) {
        timeoutMsg = '❌ 连接超时 (45 秒)。请检查：\n1. 网络连接是否稳定\n2. 是否使用了应用专用密码\n3. 稍后重试';
      } else {
        timeoutMsg = '❌ 连接超时。请检查：\n1. 服务器是否运行\n2. 网络连接\n3. 邮箱和密码是否正确';
      }
      showStatus('connectionStatus', timeoutMsg, 'error');
    } else {
      showStatus('connectionStatus', `❌ 连接错误: ${e.message}`, 'error');
    }
    console.error('Connection error:', e);
  }
}
```

**优势**:
- ✅ 所有用户都获得更好的反馈体验
- ✅ 根据提供商特点提供针对性的提示
- ✅ 显示连接耗时帮助用户了解性能
```typescript
async function connect() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  if (!email || !password) {
    showStatus('connectionStatus', '请输入邮箱和密码', 'error');
    return;
  }

  showStatus('connectionStatus', '正在连接...', 'info');
  
  // 🆕 Progressive feedback timers
  const feedback10s = setTimeout(() => {
    showStatus('connectionStatus', '⏳ 连接较慢，请稍候...', 'info');
  }, 10000);
  
  const feedback30s = setTimeout(() => {
    if (email.includes('gmail')) {
      showStatus('connectionStatus', '⏳ Gmail 响应缓慢，继续等待中...', 'info');
    } else {
      showStatus('connectionStatus', '⏳ 连接时间较长，请耐心等待...', 'info');
    }
  }, 30000);
  
  try {
    const controller = new AbortController();
    // 🆕 Increase timeout for Gmail
    const timeout = email.includes('gmail') ? 90000 : 45000; // Gmail: 90s, Others: 45s
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const startTime = Date.now();
    
    const res = await apiRequest('/api/connect', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    clearTimeout(feedback10s);
    clearTimeout(feedback30s);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!res.ok) {
      const error = await res.json();
      showStatus('connectionStatus', `连接失败: ${error.error || 'Unknown error'}`, 'error');
      return;
    }
    
    const data = await res.json();
    
    if (data.success) {
      sessionId = data.sessionId;
      document.getElementById('connectionForm').classList.add('hidden');
      document.getElementById('connectedInfo').classList.remove('hidden');
      document.getElementById('connectedEmail').textContent = email;
      
      const virtualFolders = ['[Gmail]', '[Google Mail]'];
      const validFolders = data.folders.filter(f => !virtualFolders.includes(f));
      
      const folderSelect = document.getElementById('folder');
      folderSelect.innerHTML = validFolders.map(f => `<option value="${f}">${f}</option>`).join('');
      
      // 🆕 Show connection time
      showStatus('connectionStatus', `✅ 连接成功！(耗时 ${elapsed} 秒)`, 'success');
      
      if (currentModule === 'email-management') {
        initEmailManagement();
      }
    } else {
      showStatus('connectionStatus', `连接失败: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (e) {
    clearTimeout(feedback10s);
    clearTimeout(feedback30s);
    
    if (e.name === 'AbortError') {
      const timeoutMsg = email.includes('gmail') 
        ? '❌ 连接超时 (90 秒)。Gmail 连接较慢，请检查：\n1. 网络连接是否稳定\n2. 是否使用了应用专用密码\n3. 稍后重试'
        : '❌ 连接超时。请检查：\n1. 服务器是否运行\n2. 网络连接\n3. 邮箱和密码是否正确';
      showStatus('connectionStatus', timeoutMsg, 'error');
    } else {
      showStatus('connectionStatus', `❌ 连接错误: ${e.message}`, 'error');
    }
    console.error('Connection error:', e);
  }
}
```

## 数据模型

### 连接配置（增强）

```typescript
// 扩展现有的 ConnectionOptions
interface ConnectionOptions {
  maxRetries?: number;
  retryDelay?: number;
  retryDelayMax?: number;        // 🆕 新增
  connectionTimeout?: number;
  operationTimeout?: number;     // 🆕 新增
  idleTimeout?: number;
}

// 提供商特定配置
interface ProviderConnectionOptions {
  yahoo: Required<ConnectionOptions>;
  gmail: Required<ConnectionOptions>;
}
```

### 错误统计

```typescript
interface ConnectionStats {
  provider: EmailProvider;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  averageConnectionTime: number;
  lastConnectionTime: Date;
  errorBreakdown: Record<ErrorType, number>;
}
```

## 正确性属性

*属性是一个特征或行为，应该在系统的所有有效执行中保持为真。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### 属性 1: Gmail 超时大于 Yahoo 超时

*对于任何* 连接配置，Gmail 的连接超时时间应该大于或等于 Yahoo 的连接超时时间

**验证: 需求 1.1**

### 属性 2: 重试延迟指数增长

*对于任何* 重试序列（attempt > 1），每次重试的延迟时间应该是前一次的 2 倍（直到达到最大延迟）

**验证: 需求 2.1**

### 属性 3: 认证错误不重试

*对于任何* 认证失败的连接尝试，系统不应该进行重试

**验证: 需求 2.2**

### 属性 4: Keep-Alive 定期执行

*对于任何* 启用 Keep-Alive 的连接，NOOP 命令应该在配置的间隔时间内定期发送

**验证: 需求 4.4**

### 属性 5: 错误分类完整性

*对于任何* 捕获的错误，都应该被分类到已定义的错误类型之一（认证、网络、超时、速率限制、服务器、未知）

**验证: 需求 10.1-10.5**

### 属性 6: 速率限制延迟

*对于任何* 速率限制错误，重试延迟应该至少为 60 秒

**验证: 需求 2.5, 7.2**

### 属性 7: 批量重连指数退避

*对于任何* 提取过程中的重连序列，每次重连的延迟应该呈指数增长

**验证: 需求 2.1**

### 属性 8: 连接成功后启动 Keep-Alive

*对于任何* 成功建立的连接，Keep-Alive 机制应该自动启动

**验证: 需求 4.4**

## 错误处理

### 错误分类策略（新增）

参见 `src/error-classifier.ts` 的完整实现（在组件和接口章节）。

### 错误恢复策略

```typescript
interface RecoveryStrategy {
  shouldRetry: boolean;
  delay: number;
  maxAttempts: number;
  userMessage: string;
}

// 不同错误类型的恢复策略
const RECOVERY_STRATEGIES = {
  AUTHENTICATION: {
    shouldRetry: false,
    delay: 0,
    maxAttempts: 0,
    userMessage: '认证失败，请检查邮箱地址和应用专用密码'
  },
  RATE_LIMIT: {
    shouldRetry: true,
    delay: 60000, // 1 minute
    maxAttempts: 3,
    userMessage: 'Gmail 速率限制，等待1分钟后重试'
  },
  NETWORK: {
    shouldRetry: true,
    delay: (attempt) => Math.min(2000 * Math.pow(2, attempt), 30000),
    maxAttempts: 5,
    userMessage: '网络连接错误，正在重试...'
  },
  TIMEOUT: {
    shouldRetry: true,
    delay: (attempt) => Math.min(3000 * Math.pow(2, attempt), 60000),
    maxAttempts: 3,
    userMessage: '连接超时，正在重试...'
  },
  SERVER_ERROR: {
    shouldRetry: true,
    delay: 5000,
    maxAttempts: 3,
    userMessage: '服务器错误，正在重试...'
  },
  UNKNOWN: {
    shouldRetry: true,
    delay: 3000,
    maxAttempts: 2,
    userMessage: '未知错误，正在重试...'
  }
};
```

## 测试策略

### 单元测试

**阶段 1 测试**:
- 测试 Gmail 和 Yahoo 超时配置的正确性
- 测试指数退避延迟计算
- 测试错误分类逻辑（6种错误类型）
- 测试 Keep-Alive 定时器的启动和停止

**阶段 2 测试**:
- 测试提取过程中的指数退避重连
- 测试渐进式反馈的时间触发

### 属性测试

- **属性 1**: 验证 Gmail 超时 >= Yahoo 超时
- **属性 2**: 生成随机重试序列，验证延迟指数增长
- **属性 3**: 生成认证错误，验证不会重试
- **属性 4**: 模拟时间流逝，验证 Keep-Alive 周期
- **属性 5**: 生成各种错误，验证分类完整性
- **属性 6**: 验证速率限制错误的延迟 >= 60秒
- **属性 7**: 验证批量重连的指数退避
- **属性 8**: 验证连接成功后 Keep-Alive 启动

### 集成测试

- 测试完整的 Gmail 连接流程（包含超时和重试）
- 测试提取过程中的连接失败和恢复
- 测试 Keep-Alive 在真实连接中的行为
- 测试错误分类和恢复策略的实际效果

### 性能测试

- 测试 Gmail 连接的平均时间（应 < 60秒）
- 测试重试机制对性能的影响
- 测试 Keep-Alive 的开销（应该很小）

## 实现优先级

### 阶段 1: 基础增强（高优先级）⭐⭐⭐

**预计工作量**: 4-6 小时

1. **Gmail 超时优化** (1-2小时)
   - 修改 `ConnectionOptions` 接口
   - 添加 `PROVIDER_CONNECTION_OPTIONS`
   - 修改 `IMAPConnector` 构造函数
   - 更新 `src/server.ts` 中的连接调用
   - 更新前端超时配置

2. **指数退避重试** (1-2小时)
   - 添加 `calculateRetryDelay()` 方法
   - 修改 `connect()` 方法中的重试逻辑
   - 添加 `retryDelayMax` 配置项

3. **错误分类和处理** (2小时)
   - 创建 `src/error-classifier.ts`
   - 实现 `ErrorClassifier` 类
   - 集成到 `IMAPConnector.connect()`
   - 添加单元测试

**预期效果**:
- 所有提供商的连接成功率提升 30-50%
- 连接超时减少 60%
- 更友好的错误提示
- Yahoo 用户也获得更好的连接体验

### 阶段 2: 连接管理增强（中优先级）⭐⭐

**预计工作量**: 3-4 小时

4. **Keep-Alive 保活机制** (1-2小时)
   - 添加 `startKeepAlive()` 和 `stopKeepAlive()` 方法
   - 修改 `connect()` 和 `disconnect()` 方法
   - 配置 3 分钟间隔

5. **提取过程指数退避重连** (1小时)
   - 修改 `/api/extract` 中的 `reconnect()` 函数
   - 使用指数退避计算延迟

6. **渐进式连接反馈** (1小时)
   - 修改前端 `connect()` 函数
   - 添加 10秒和30秒反馈定时器
   - 显示连接耗时

**预期效果**:
- 长时间提取不再断开连接
- 用户体验更好（知道系统在工作）
- 重连更智能

### 阶段 3: 高级特性（低优先级，可选）⭐

**预计工作量**: 8-12 小时

7. **连接池管理** (4-6小时)
   - 实现 `ConnectionManager` 类
   - 连接复用逻辑
   - 空闲连接清理

8. **断路器模式** (2-3小时)
   - 实现 `CircuitBreaker` 类
   - 集成到连接流程

9. **诊断工具** (2-3小时)
   - 实现 `ConnectionDiagnostics` 类
   - 添加 `/api/diagnose` 端点
   - 前端诊断界面

**注意**: 阶段 3 功能在当前单用户场景下不是必需的，可以根据实际需求决定是否实施。

## 配置示例

### 提供商配置对比

```typescript
const PROVIDER_CONNECTION_OPTIONS = {
  // Yahoo 配置：快速稳定
  yahoo: {
    maxRetries: 3,                 // 3次重试
    retryDelay: 2000,              // 基础延迟 2秒
    retryDelayMax: 10000,          // 最大延迟 10秒
    connectionTimeout: 30000,      // 连接超时 30秒
    operationTimeout: 20000,       // 操作超时 20秒
    idleTimeout: 300000,           // Keep-Alive 间隔 5分钟
  },
  
  // Gmail 配置：需要更多耐心
  gmail: {
    maxRetries: 5,                 // 5次重试（更多）
    retryDelay: 2000,              // 基础延迟 2秒
    retryDelayMax: 30000,          // 最大延迟 30秒（更长）
    connectionTimeout: 60000,      // 连接超时 60秒（2倍）
    operationTimeout: 45000,       // 操作超时 45秒
    idleTimeout: 180000,           // Keep-Alive 间隔 3分钟（更频繁）
  },
  
  // 默认配置：适用于其他提供商
  default: {
    maxRetries: 3,                 // 3次重试
    retryDelay: 2000,              // 基础延迟 2秒
    retryDelayMax: 15000,          // 最大延迟 15秒
    connectionTimeout: 40000,      // 连接超时 40秒
    operationTimeout: 30000,       // 操作超时 30秒
    idleTimeout: 240000,           // Keep-Alive 间隔 4分钟
  },
};
```

### 指数退避示例

**Yahoo (3次重试)**:
```
尝试 1: 2秒
尝试 2: 4秒
尝试 3: 8秒
```

**Gmail (5次重试)**:
```
尝试 1: 2秒
尝试 2: 4秒
尝试 3: 8秒
尝试 4: 16秒
尝试 5: 30秒 (达到最大值)
```

### 配置参数说明

| 参数 | Yahoo | Gmail | 默认 | 说明 |
|------|-------|-------|------|------|
| **maxRetries** | 3 | 5 | 3 | 最大重试次数 |
| **retryDelayMax** | 10s | 30s | 15s | 最大重试延迟 |
| **connectionTimeout** | 30s | 60s | 40s | 连接超时 |
| **operationTimeout** | 20s | 45s | 30s | 操作超时 |
| **idleTimeout** | 5min | 3min | 4min | Keep-Alive 间隔 |

### 为什么参数不同？

**Yahoo**:
- ✅ 响应快速，30秒通常足够
- ✅ 连接稳定，3次重试足够
- ✅ 不容易断开，5分钟 Keep-Alive 足够

**Gmail**:
- ⚠️ 响应较慢，需要 60秒超时
- ⚠️ 更容易超时，需要 5次重试
- ⚠️ 容易断开，需要 3分钟 Keep-Alive

**其他提供商**:
- 📊 使用中间值作为默认配置
- 📊 可以根据实际情况调整

## 监控和日志

### 关键指标

- 连接成功率（按提供商）
- 平均连接时间（Gmail vs Yahoo）
- 重试次数分布
- 错误类型分布
- Keep-Alive 发送次数

### 日志级别

- **DEBUG**: 详细的连接过程信息、Keep-Alive 发送
- **INFO**: 连接成功、重试、错误分类结果
- **WARN**: 连接缓慢、接近超时、Keep-Alive 失败
- **ERROR**: 连接失败、认证错误、未知错误

### 日志示例

```
[INFO] [IMAPConnector] Connecting to Gmail (attempt 1/5)...
[INFO] [IMAPConnector] Connected successfully in 12.3s
[INFO] [IMAPConnector] Keep-alive started (interval: 3min)
[DEBUG] [IMAPConnector] Keep-alive NOOP sent
[WARN] [IMAPConnector] Connection attempt 2 failed, retrying in 4000ms...
[ERROR] [IMAPConnector] Connection failed after 5 attempts: timeout
```

## 向后兼容性

- ✅ 保持现有 API 接口不变
- ✅ 新功能通过配置选项启用
- ✅ 默认配置保持当前行为（Yahoo）
- ✅ 渐进式迁移策略
- ✅ 不破坏现有的批量处理和重连逻辑

## 迁移指南

### 从现有代码迁移

**步骤 1**: 更新 `IMAPConnector` 构造函数调用

```typescript
// 旧代码
const connector = new IMAPConnector();

// 新代码（指定提供商）
const connector = new IMAPConnector(provider); // provider: 'gmail' | 'yahoo'
```

**步骤 2**: 无需修改其他代码

所有其他代码保持不变，因为改进是在 `IMAPConnector` 内部实现的。

### 测试迁移

1. 运行现有测试，确保没有破坏
2. 添加新的测试用例
3. 验证 Gmail 连接成功率提升

## 风险评估

### 低风险

- Gmail 超时优化：只是增加超时时间，不会破坏现有功能
- 指数退避：改进重试策略，不影响成功连接
- 错误分类：增强错误处理，不改变基本流程

### 中风险

- Keep-Alive：需要测试定时器的资源使用
- 提取过程重连：需要确保不影响现有的批量处理

### 缓解措施

- 充分的单元测试和集成测试
- 分阶段实施，每个阶段独立验证
- 保留回滚选项（通过配置禁用新功能）

## 性能影响

### 预期改进

**Gmail**:
- 连接成功率: +30-50%
- 连接超时减少: -60%
- 平均连接时间: 可能增加 5-10秒（但成功率更高）

**Yahoo**:
- 连接体验更流畅
- 错误处理更智能
- 长时间提取更稳定

**所有提供商**:
- 统一的高质量连接体验
- 更好的错误恢复能力

### 资源使用

- Keep-Alive 定时器: 每个连接 ~1KB 内存
- 错误分类: 可忽略的 CPU 开销
- 总体影响: 非常小

## 总结

本设计文档描述了在现有完善的连接机制基础上的增量改进方案。通过**统一的连接管理机制**和**提供商特定的配置参数**，可以显著提升所有邮件提供商（Yahoo、Gmail 等）的连接稳定性和成功率。

### 核心设计理念

**统一机制 + 差异化配置**:
- ✅ 所有提供商使用相同的连接管理机制（重试、Keep-Alive、错误分类等）
- ✅ 根据不同提供商的特点使用不同的配置参数
- ✅ Yahoo: 30秒超时、3次重试、5分钟 Keep-Alive（快速稳定）
- ✅ Gmail: 60秒超时、5次重试、3分钟 Keep-Alive（需要更多耐心）
- ✅ 其他: 40秒超时、3次重试、4分钟 Keep-Alive（默认配置）

### 关键优势

- ✅ **普遍受益**: 所有用户（Yahoo、Gmail 等）都获得改进的连接体验
- ✅ **增量式改进**: 不破坏现有功能，在现有代码基础上优化
- ✅ **易于扩展**: 添加新的邮件提供商只需配置参数
- ✅ **实施简单**: 风险低，预期效果明显
- ✅ **向后兼容**: 保持现有 API 接口不变

### 预期效果

**Gmail 用户**:
- 连接成功率提升 30-50%
- 连接超时减少 60%
- 更友好的错误提示和进度反馈

**Yahoo 用户**:
- 连接体验更流畅
- 更智能的错误处理
- 长时间提取不再断开

**所有用户**:
- 统一的高质量连接体验
- 更好的错误分类和恢复策略
- 渐进式反馈让用户了解连接状态

### 建议实施顺序

1. **阶段 1（高优先级）** - 立即实施
   - 提供商特定超时配置
   - 指数退避重试
   - 完善的错误分类

2. **阶段 2（中优先级）** - 短期实施
   - Keep-Alive 保活机制
   - 提取过程指数退避重连
   - 渐进式连接反馈

3. **阶段 3（低优先级）** - 根据需求决定
   - 连接池管理
   - 断路器模式
   - 诊断工具
