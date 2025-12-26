# Design Document

## Overview

本设计文档描述折扣码提取工作流的增强功能。该功能扩展现有的提取模块，提供完整的规则管理生命周期：从邮件预览中发现目标字符串，自动生成规则，手动编辑验证，保存到历史，最终应用规则进行批量提取。

### 核心功能

1. **规则历史管理**: 展示、查看、删除已保存的提取规则
2. **邮件筛选预览**: 按主题筛选邮件，预览内容，支持内容搜索
3. **规则自动生成**: 从目标字符串自动生成正则表达式
4. **规则编辑验证**: 手动编辑规则字段，验证正则匹配效果
5. **规则应用提取**: 使用保存的规则进行批量折扣码提取

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Extraction Module UI                              │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│  Rule        │  Email       │  Rule        │  Extraction           │
│  History     │  Preview     │  Editor      │  Results              │
│  Panel       │  Panel       │  Panel       │  Panel                │
└──────┬───────┴──────┬───────┴──────┬───────┴───────────┬───────────┘
       │              │              │                   │
       └──────────────┴──────────────┴───────────────────┘
                              │
                         REST API
                              │
┌─────────────────────────────┴───────────────────────────────────────┐
│                        Backend Services                              │
├──────────────┬──────────────┬──────────────┬───────────────────────┤
│  Rule        │  Email       │  Regex       │  Extraction           │
│  Storage     │  Service     │  Generator   │  Service              │
└──────────────┴──────────────┴──────────────┴───────────────────────┘
```

### UI 布局

```
┌─────────────────────────────────────────────────────────────────────┐
│ 提取折扣码                                                           │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 历史规则                                              [展开/收起] │ │
│ │ ┌─────────────────────────────────────────────────────────────┐ │ │
│ │ │ 规则名称        │ 主题模式        │ 标签    │ 操作          │ │ │
│ │ │ Amazon优惠码    │ Your code       │ 电商    │ [使用] [删除] │ │ │
│ │ │ Uber折扣        │ discount        │ 出行    │ [使用] [删除] │ │ │
│ │ └─────────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 邮件筛选                                                        │ │
│ │ 主题筛选: [________________] [搜索]                             │ │
│ │ 匹配邮件: 15封                                                  │ │
│ └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 邮件预览                                    查找: [____] [↑][↓] │ │
│ │ ┌─────────────────────────────────────────────────────────────┐ │ │
│ │ │ Subject: Your Amazon discount code                          │ │ │
│ │ │ From: amazon@email.com                                      │ │ │
│ │ │ ─────────────────────────────────────────────────────────── │ │ │
│ │ │ Dear Customer,                                              │ │ │
│ │ │ Your discount code is: [ABC123XYZ] (highlighted)            │ │ │
│ │ │ ...                                                         │ │ │
│ │ └─────────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 规则编辑                                                        │ │
│ │ 目标字符串: [ABC123XYZ_______] [自动生成规则]                   │ │
│ │ ─────────────────────────────────────────────────────────────── │ │
│ │ 模式名称:   [Amazon优惠码____]                                  │ │
│ │ 主题模式:   [Your.*discount.*]                                  │ │
│ │ 正则表达式: [[A-Z0-9]{9}_____]                                  │ │
│ │ 标签:       [电商____________]                                  │ │
│ │                                                                 │ │
│ │ [验证规则]  [保存规则]  [使用规则]                              │ │
│ └─────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 提取结果                                                        │ │
│ │ ┌─────────────────────────────────────────────────────────────┐ │ │
│ │ │ 折扣码      │ 来源邮件                    │ 日期            │ │ │
│ │ │ ABC123XYZ   │ Your Amazon discount code   │ 2025-01-01      │ │ │
│ │ │ DEF456UVW   │ Your Amazon discount code   │ 2025-01-02      │ │ │
│ │ └─────────────────────────────────────────────────────────────┘ │ │
│ │ [导出CSV]                                                       │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Extended Rule Interface

```typescript
interface ExtractionRule {
  id: string;
  patternName: string;        // 模式名称
  subjectPattern: string;     // 主题匹配模式
  regexPattern: string;       // 正则表达式
  regexFlags: string;         // 正则标志 (g, i, m)
  tags: string[];             // 标签数组
  createdAt: string;
  lastUsed?: string;
}
```

### 2. Regex Generator Service

```typescript
interface RegexGeneratorService {
  // 从目标字符串生成正则表达式
  generateFromTarget(target: string): GeneratedPattern;
  
  // 转义特殊字符
  escapeSpecialChars(input: string): string;
  
  // 识别常见模式并建议通用正则
  suggestPatterns(target: string): PatternSuggestion[];
  
  // 验证正则语法
  validateRegex(pattern: string, flags: string): ValidationResult;
}

interface GeneratedPattern {
  literal: string;           // 字面量匹配
  suggestions: PatternSuggestion[];
}

interface PatternSuggestion {
  pattern: string;
  description: string;
  confidence: number;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}
```

### 3. Email Preview Service

```typescript
interface EmailPreviewService {
  // 搜索邮件内容中的字符串
  searchInContent(content: string, query: string): SearchResult[];
  
  // 高亮匹配内容
  highlightMatches(content: string, matches: SearchResult[]): string;
}

interface SearchResult {
  index: number;
  length: number;
  context: string;  // 匹配周围的上下文
}
```

### 4. Rule Validation Service

```typescript
interface RuleValidationService {
  // 验证规则结构
  validateRuleStructure(rule: Partial<ExtractionRule>): ValidationResult;
  
  // 测试正则匹配
  testRegexMatch(pattern: string, flags: string, content: string): MatchResult;
}

interface MatchResult {
  matches: string[];
  positions: number[];
}
```

### 5. API Endpoints (扩展)

#### Rule Management APIs
- `GET /api/patterns` - 获取规则列表 (已存在，需扩展返回字段)
- `POST /api/patterns` - 保存规则 (已存在，需扩展字段)
- `DELETE /api/patterns/:id` - 删除规则 (已存在)
- `PUT /api/patterns/:id/use` - 标记规则使用，更新 lastUsed

#### Regex Generation APIs
- `POST /api/regex/generate` - 从目标字符串生成正则
- `POST /api/regex/validate` - 验证正则语法
- `POST /api/regex/test` - 测试正则匹配

## Data Models

### Extended Pattern Storage (data/users/{userId}/patterns.json)

```json
{
  "patterns": [
    {
      "id": "uuid-string",
      "patternName": "Amazon优惠码",
      "subjectPattern": "Your.*discount.*code",
      "regexPattern": "[A-Z0-9]{8,12}",
      "regexFlags": "gi",
      "tags": ["电商", "Amazon"],
      "createdAt": "2025-01-01T00:00:00Z",
      "lastUsed": "2025-01-02T00:00:00Z"
    }
  ]
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Rule Data Serialization Round-Trip

*For any* valid ExtractionRule object, serializing to JSON and then deserializing should produce an equivalent object with all fields preserved (patternName, subjectPattern, regexPattern, regexFlags, tags).

**Validates: Requirements 1.4, 1.5, 4.7, 4.8**

### Property 2: Rule List Completeness

*For any* set of saved rules, the list operation should return all rules with their pattern name, subject pattern, and tags fields present.

**Validates: Requirements 1.1, 1.2**

### Property 3: Rule Deletion Consistency

*For any* rule that is deleted, subsequent list operations should not include that rule.

**Validates: Requirements 1.3**

### Property 4: Subject Filter Accuracy

*For any* subject filter pattern and set of emails, all returned emails should have subjects that match the filter pattern.

**Validates: Requirements 2.1**

### Property 5: Content Search Completeness

*For any* search query and email content, the search function should return all occurrences of the query string with correct positions.

**Validates: Requirements 2.4**

### Property 6: Regex Generation Correctness

*For any* target string, the generated literal regex pattern should match the original target string when applied.

**Validates: Requirements 3.1**

### Property 7: Special Character Escaping

*For any* string containing regex special characters (. * + ? ^ $ { } [ ] \ | ( )), the escape function should produce a pattern that matches the literal string.

**Validates: Requirements 3.2**

### Property 8: Regex Validation Accuracy

*For any* regex pattern string, the validation function should correctly identify valid patterns as valid and invalid patterns as invalid with appropriate error messages.

**Validates: Requirements 3.5, 3.6, 4.4**

### Property 9: Rule Validation Completeness

*For any* rule object missing required fields (patternName, subjectPattern, regexPattern), the validation should reject it with a clear error indicating the missing field.

**Validates: Requirements 4.7, 4.8**

### Property 10: Regex Match Correctness

*For any* valid regex pattern and content string, the test function should return all matches that the regex would find.

**Validates: Requirements 4.3**

### Property 11: Rule Save and Retrieve Consistency

*For any* rule that is saved, retrieving it should return the same patternName, subjectPattern, regexPattern, regexFlags, and tags.

**Validates: Requirements 4.6**

### Property 12: Extraction Result Completeness

*For any* extraction operation with a valid rule, all extracted codes should include their source email information (subject, date).

**Validates: Requirements 5.2, 5.3**

### Property 13: Last Used Timestamp Update

*For any* rule that is used for extraction, the rule's lastUsed timestamp should be updated to a time after the previous lastUsed value.

**Validates: Requirements 5.4**

## Error Handling

### Regex Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 400 | Invalid regex syntax | `{ error: "Invalid regex: {syntaxError}" }` |
| 400 | Empty regex pattern | `{ error: "Regex pattern cannot be empty" }` |
| 400 | Invalid regex flags | `{ error: "Invalid regex flags: {flags}" }` |

### Rule Validation Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 400 | Missing pattern name | `{ error: "Pattern name is required" }` |
| 400 | Missing subject pattern | `{ error: "Subject pattern is required" }` |
| 400 | Missing regex pattern | `{ error: "Regex pattern is required" }` |
| 400 | Invalid rule structure | `{ error: "Invalid rule structure: {details}" }` |

### Search Errors

| Error Code | Condition | Response |
|------------|-----------|----------|
| 400 | Empty search query | `{ error: "Search query cannot be empty" }` |
| 404 | No emails found | `{ error: "No emails match the filter" }` |

## Testing Strategy

### Dual Testing Approach

本功能采用单元测试和属性测试相结合的测试策略：

- **单元测试**: 验证具体示例、边界情况和错误条件
- **属性测试**: 验证应在所有输入上成立的通用属性

### Property-Based Testing Framework

使用 **fast-check** 作为属性测试库，配置每个属性测试运行至少 100 次迭代。

### Test File Organization

```
src/
├── regex-generator.ts
├── regex-generator.test.ts           # 单元测试
├── regex-generator.property.test.ts  # 属性测试
├── rule-validator.ts
├── rule-validator.test.ts
├── rule-validator.property.test.ts
└── ...
```

### Property Test Annotations

每个属性测试必须使用以下格式标注：

```typescript
// **Feature: discount-code-extraction-workflow, Property 6: Regex Generation Correctness**
// **Validates: Requirements 3.1**
test.prop([fc.string({ minLength: 1 })], { numRuns: 100 })('generated regex matches target', (target) => {
  const result = generateFromTarget(target);
  const regex = new RegExp(result.literal);
  expect(regex.test(target)).toBe(true);
});
```

### Test Data Generators (Arbitraries)

```typescript
// ExtractionRule arbitrary
const extractionRuleArbitrary = fc.record({
  id: fc.uuid(),
  patternName: fc.string({ minLength: 1, maxLength: 50 }),
  subjectPattern: fc.string({ minLength: 1, maxLength: 100 }),
  regexPattern: fc.string({ minLength: 1, maxLength: 200 }),
  regexFlags: fc.constantFrom('g', 'gi', 'i', 'gm', 'gim'),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
  createdAt: fc.date().map(d => d.toISOString()),
  lastUsed: fc.option(fc.date().map(d => d.toISOString()))
});

// Target string with special characters
const targetStringArbitrary = fc.string({ minLength: 1, maxLength: 100 });

// Regex special characters
const specialCharsArbitrary = fc.constantFrom('.', '*', '+', '?', '^', '$', '{', '}', '[', ']', '\\', '|', '(', ')');
```

### Unit Test Coverage

单元测试应覆盖：

1. **正则生成模块**
   - 简单字符串生成
   - 特殊字符转义
   - 常见模式识别（数字、字母数字码）

2. **规则验证模块**
   - 必填字段验证
   - 正则语法验证
   - 数据类型验证

3. **搜索功能**
   - 单次匹配
   - 多次匹配
   - 无匹配情况

4. **API 端点**
   - 请求参数验证
   - 响应格式一致性
   - 错误处理
