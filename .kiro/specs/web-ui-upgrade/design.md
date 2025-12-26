# Design Document

## Overview

本设计文档描述 Yahoo Mail Extractor Web UI 升级的技术架构和实现方案。升级将现有单页面应用转变为具有用户认证、服务端数据持久化和多功能模块的完整 Web 应用。

### 核心变更

1. **认证层**: 添加用户登录系统，使用 JWT token 进行会话管理
2. **数据持久化**: 从浏览器 localStorage 迁移到服务端 JSON 文件存储
3. **UI 重构**: 添加左侧导航栏，将功能拆分为三个独立模块
4. **API 扩展**: 新增用户管理、邮箱管理、模式历史等 REST API 端点

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (HTML/JS)                        │
├─────────────┬─────────────────┬─────────────────┬───────────────┤
│   Login     │  Navigation     │   Feature       │   API         │
│   Page      │  Sidebar        │   Modules       │   Client      │
└─────────────┴─────────────────┴─────────────────┴───────┬───────┘
                                                          │
                                                    REST API
                                                          │
┌─────────────────────────────────────────────────────────┴───────┐
│                        Backend (Express.js)                      │
├─────────────┬─────────────────┬─────────────────┬───────────────┤
│   Auth      │   User Data     │   Mailbox       │   Email       │
│   Middleware│   Service       │   Service       │   Service     │
└─────────────┴────────┬────────┴────────┬────────┴───────────────┘
                       │                 │
              ┌────────┴────────┐ ┌──────┴──────┐
              │  JSON Storage   │ │   IMAP      │
              │  (File System)  │ │   Connection│
              └─────────────────┘ └─────────────┘
```

### 目录结构

```
project/
├── data/                          # 服务端数据存储
│   ├── users.json                 # 用户账户信息
│   └── users/                     # 用户数据目录
│       └── {userId}/
│           ├── mailboxes.json     # 邮箱账户
│           └── patterns.json      # 提取模式历史
├── src/
│   ├── server.ts                  # Express 服务器 (扩展)
│   ├── auth.ts                    # 认证模块 (新增)
│   ├── storage.ts                 # 数据存储模块 (新增)
│   └── ...                        # 现有模块
└── public/
    └── index.html                 # 前端页面 (重构)
```

## Components and Interfaces

### 1. Authentication Module (auth.ts)

```typescript
interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

interface Session {
  userId: string;
  token: string;
  expiresAt: number;
}

interface AuthService {
  register(username: string, password: string): Promise<User>;
  login(username: string, password: string): Promise<Session>;
  validateToken(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
}
```

### 2. Storage Module (storage.ts)

```typescript
interface Mailbox {
  id: string;
  email: string;
  encryptedPassword: string;
  addedAt: string;
  lastUsed?: string;
}

interface PatternHistory {
  id: string;
  subjectPattern: string;
  regexPattern: string;
  regexFlags: string;
  createdAt: string;
  lastUsed?: string;
}

interface StorageService {
  // User data
  getMailboxes(userId: string): Promise<Mailbox[]>;
  saveMailbox(userId: string, mailbox: Mailbox): Promise<void>;
  deleteMailbox(userId: string, mailboxId: string): Promise<void>;
  
  // Pattern history
  getPatterns(userId: string): Promise<PatternHistory[]>;
  savePattern(userId: string, pattern: PatternHistory): Promise<void>;
  deletePattern(userId: string, patternId: string): Promise<void>;
}
```

### 3. API Endpoints

#### Authentication APIs
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `GET /api/auth/me` - 获取当前用户信息

#### Mailbox Management APIs
- `GET /api/mailboxes` - 获取用户邮箱列表
- `POST /api/mailboxes` - 添加新邮箱
- `DELETE /api/mailboxes/:id` - 删除邮箱

#### Pattern History APIs
- `GET /api/patterns` - 获取模式历史
- `POST /api/patterns` - 保存新模式
- `DELETE /api/patterns/:id` - 删除模式

#### Email Management APIs (扩展现有)
- `GET /api/folders` - 获取邮箱文件夹列表
- `POST /api/emails/list` - 获取邮件列表（不含正文）
- `POST /api/emails/delete` - 批量删除邮件

### 4. Frontend Components

#### Login Page
- 用户名/密码输入表单
- 登录/注册切换
- 错误提示显示

#### Navigation Sidebar
- 固定在左侧，宽度 200px
- 三个导航项：邮箱管理、提取折扣码、邮件管理
- 当前激活项高亮显示
- 用户信息和登出按钮

#### Feature Modules
- **邮箱管理**: 邮箱列表、添加/删除邮箱表单
- **提取折扣码**: 现有提取功能 + 模式历史列表
- **邮件管理**: 文件夹树、邮件列表、搜索/删除工具栏

## Data Models

### Users Storage (data/users.json)

```json
{
  "users": [
    {
      "id": "uuid-string",
      "username": "user1",
      "passwordHash": "bcrypt-hash",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### Mailboxes Storage (data/users/{userId}/mailboxes.json)

```json
{
  "mailboxes": [
    {
      "id": "uuid-string",
      "email": "user@yahoo.com",
      "encryptedPassword": "encrypted-app-password",
      "addedAt": "2025-01-01T00:00:00Z",
      "lastUsed": "2025-01-02T00:00:00Z"
    }
  ]
}
```

### Patterns Storage (data/users/{userId}/patterns.json)

```json
{
  "patterns": [
    {
      "id": "uuid-string",
      "subjectPattern": "Your discount code",
      "regexPattern": "(?<code>[A-Z0-9]{8})",
      "regexFlags": "gi",
      "createdAt": "2025-01-01T00:00:00Z",
      "lastUsed": "2025-01-02T00:00:00Z"
    }
  ]
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Data Serialization Round-Trip

*For any* valid data object (User, Mailbox, PatternHistory, or Configuration), serializing to JSON and then deserializing should produce an equivalent object with all fields preserved.

**Validates: Requirements 1.7, 2.5, 4.7, 5.7**

### Property 2: Password Hashing Security

*For any* user registration with a plaintext password, the stored passwordHash field should never equal the original plaintext password, and should be a valid bcrypt hash.

**Validates: Requirements 1.6**

### Property 3: Mailbox Password Encryption

*For any* saved mailbox with an App Password, the stored encryptedPassword field should never equal the original plaintext password, and should be decryptable back to the original.

**Validates: Requirements 4.5**

### Property 4: Valid Login Returns Session

*For any* registered user with valid credentials, calling login should return a valid session token that can be used for subsequent authenticated requests.

**Validates: Requirements 1.2**

### Property 5: Invalid Login Rejected

*For any* login attempt with non-existent username or incorrect password, the system should reject the request with an authentication error and not return a session token.

**Validates: Requirements 1.3**

### Property 6: Session Token Validity

*For any* valid session token, calling validateToken should return the associated user until the session is explicitly logged out or expired.

**Validates: Requirements 1.5**

### Property 7: Logout Invalidates Session

*For any* valid session, after calling logout, the session token should no longer be valid for authentication.

**Validates: Requirements 1.4**

### Property 8: User Data Isolation

*For any* two different users, their data (mailboxes, patterns) should be stored in separate directories and one user should not be able to access another user's data.

**Validates: Requirements 2.3**

### Property 9: Invalid Data Structure Rejection

*For any* data object that does not conform to the expected schema (missing required fields, wrong types), the system should reject it with a clear validation error.

**Validates: Requirements 2.4, 4.6, 5.6**

### Property 10: Mailbox CRUD Consistency

*For any* sequence of mailbox operations (add, list, delete), the list operation should always reflect the current state after all previous operations.

**Validates: Requirements 4.1, 4.2, 4.4**

### Property 11: Pattern History CRUD Consistency

*For any* sequence of pattern operations (save, list, delete), the list operation should always reflect the current state after all previous operations.

**Validates: Requirements 5.2, 5.3, 5.5**

### Property 12: Email List Without Body

*For any* email list request, the returned email objects should contain subject, sender, and recipient fields but should not contain the full email body content.

**Validates: Requirements 6.2**

### Property 13: Email Search Filtering

*For any* subject pattern search, all returned emails should have subjects that match the given pattern, and the count should equal the number of returned emails.

**Validates: Requirements 6.3**

### Property 14: Batch Delete Moves to Trash

*For any* batch delete operation on a set of email UIDs, after the operation completes, those emails should no longer appear in the original folder and should appear in the Trash folder.

**Validates: Requirements 6.5**

### Property 15: Empty Trash Removes All

*For any* empty trash operation, after completion, the trash folder should contain zero emails.

**Validates: Requirements 6.6**

### Property 16: Pagination Correctness

*For any* paginated email list request with page size N and page number P, the returned emails should be a subset of size at most N, and requesting all pages should return all emails exactly once.

**Validates: Requirements 6.7**

### Property 17: Unauthenticated API Rejection

*For any* API request to a protected endpoint without a valid session token, the system should return a 401 Unauthorized response.

**Validates: Requirements 7.3**

### Property 18: Consistent API Response Format

*For any* API response, the JSON structure should follow a consistent format with either a success payload or an error object with message field.

**Validates: Requirements 7.4**



## Error Handling

### Authentication Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 401 | Invalid credentials | `{ error: "Invalid username or password" }` |
| 401 | Missing token | `{ error: "Authentication required" }` |
| 401 | Invalid/expired token | `{ error: "Session expired, please login again" }` |
| 409 | Username already exists | `{ error: "Username already taken" }` |

### Data Validation Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 400 | Missing required fields | `{ error: "Missing required field: {fieldName}" }` |
| 400 | Invalid field type | `{ error: "Invalid type for field: {fieldName}" }` |
| 400 | Invalid JSON format | `{ error: "Invalid JSON: {parseError}" }` |
| 400 | Invalid regex pattern | `{ error: "Invalid regex pattern: {regexError}" }` |

### Storage Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 500 | File read error | `{ error: "Failed to read data" }` |
| 500 | File write error | `{ error: "Failed to save data" }` |
| 404 | Resource not found | `{ error: "Resource not found: {resourceId}" }` |

### IMAP Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 401 | Invalid mailbox credentials | `{ error: "Failed to connect to mailbox" }` |
| 500 | IMAP connection error | `{ error: "Mailbox connection error: {message}" }` |
| 504 | IMAP timeout | `{ error: "Mailbox operation timed out" }` |

## Testing Strategy

### Dual Testing Approach

本项目采用单元测试和属性测试相结合的测试策略：

- **单元测试**: 验证具体示例、边界情况和错误条件
- **属性测试**: 验证应在所有输入上成立的通用属性

### Property-Based Testing Framework

使用 **fast-check** 作为属性测试库，配置每个属性测试运行至少 100 次迭代。

### Test File Organization

```
src/
├── auth.ts
├── auth.test.ts           # 认证模块单元测试
├── auth.property.test.ts  # 认证模块属性测试
├── storage.ts
├── storage.test.ts        # 存储模块单元测试
├── storage.property.test.ts # 存储模块属性测试
└── ...
```

### Property Test Annotations

每个属性测试必须使用以下格式标注：

```typescript
// **Feature: web-ui-upgrade, Property 1: Data Serialization Round-Trip**
// **Validates: Requirements 1.7, 2.5, 4.7, 5.7**
test.prop([userArbitrary], { numRuns: 100 })('serialization round-trip', (user) => {
  const serialized = JSON.stringify(user);
  const deserialized = JSON.parse(serialized);
  expect(deserialized).toEqual(user);
});
```

### Unit Test Coverage

单元测试应覆盖：

1. **认证模块**
   - 用户注册成功/失败场景
   - 登录成功/失败场景
   - Token 验证和过期处理
   - 登出功能

2. **存储模块**
   - 文件读写操作
   - 用户目录创建
   - 数据验证

3. **API 端点**
   - 请求参数验证
   - 响应格式一致性
   - 错误处理

### Test Data Generators (Arbitraries)

```typescript
// User arbitrary
const userArbitrary = fc.record({
  id: fc.uuid(),
  username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
  passwordHash: fc.string({ minLength: 60, maxLength: 60 }),
  createdAt: fc.date().map(d => d.toISOString())
});

// Mailbox arbitrary
const mailboxArbitrary = fc.record({
  id: fc.uuid(),
  email: fc.emailAddress(),
  encryptedPassword: fc.string({ minLength: 20 }),
  addedAt: fc.date().map(d => d.toISOString()),
  lastUsed: fc.option(fc.date().map(d => d.toISOString()))
});

// Pattern arbitrary
const patternArbitrary = fc.record({
  id: fc.uuid(),
  subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexPattern: fc.string({ minLength: 1, maxLength: 200 }),
  regexFlags: fc.constantFrom('g', 'gi', 'i', 'gm'),
  createdAt: fc.date().map(d => d.toISOString()),
  lastUsed: fc.option(fc.date().map(d => d.toISOString()))
});
```

### Integration Testing

集成测试验证完整的用户流程：

1. 用户注册 → 登录 → 添加邮箱 → 保存模式 → 登出
2. 邮件列表 → 搜索 → 批量删除 → 清空回收站
3. 会话过期 → 重新登录 → 数据恢复

