# Requirements Document

## Introduction

本功能增强 Yahoo Mail Extractor 的折扣码提取模块，提供完整的规则管理工作流。用户可以通过邮件预览查找目标字符串，自动生成提取规则，手动编辑和验证规则，保存规则到历史记录，并在目标提取中使用已保存的规则。

## Glossary

- **Extraction Rule**: 用于从邮件内容中提取折扣码的规则，包含主题名、正则表达式、模式名和标签
- **Rule History**: 保存的提取规则历史记录，用于复用和管理
- **Email Preview**: 邮件内容的预览视图，支持查找目标字符串
- **Target String**: 用户在邮件预览中选择的目标文本，用于自动生成规则
- **Rule Validation**: 验证规则正则表达式是否能正确匹配目标内容
- **Pattern Name**: 规则的唯一标识名称
- **Subject Pattern**: 用于筛选邮件的主题匹配模式
- **Tag**: 规则的分类标签，用于组织和筛选规则

## Requirements

### Requirement 1

**User Story:** As a user, I want to view and manage my saved extraction rules, so that I can reuse previously created rules efficiently.

#### Acceptance Criteria

1. WHEN the user accesses the extraction module THEN the System SHALL display a list of saved extraction rules with pattern name, subject pattern, and tags
2. WHEN the user clicks on a saved rule THEN the System SHALL display the full rule details including regex pattern
3. WHEN the user deletes a saved rule THEN the System SHALL remove the rule from storage and update the display
4. WHEN serializing rule data THEN the System SHALL validate the data structure before saving
5. WHEN deserializing rule data THEN the System SHALL validate the data structure and report parsing errors clearly

### Requirement 2

**User Story:** As a user, I want to filter emails and preview the first matching email, so that I can identify target strings for extraction.

#### Acceptance Criteria

1. WHEN the user enters a subject filter THEN the System SHALL display matching emails from the connected mailbox
2. WHEN matching emails are found THEN the System SHALL automatically preview the first email content
3. WHEN the email preview is displayed THEN the System SHALL provide a search box for finding target strings within the email
4. WHEN the user searches in the preview THEN the System SHALL highlight all matching occurrences and navigate between them
5. WHEN the user selects text in the preview THEN the System SHALL enable the "Generate Rule" action with the selected text

### Requirement 3

**User Story:** As a user, I want to automatically generate extraction rules from target strings, so that I can quickly create rules without manual regex writing.

#### Acceptance Criteria

1. WHEN the user provides a target string THEN the System SHALL generate a regex pattern that matches the target string
2. WHEN generating a regex pattern THEN the System SHALL escape special regex characters in the target string
3. WHEN the target string contains common patterns (codes, numbers) THEN the System SHALL suggest generalized regex patterns
4. WHEN a rule is generated THEN the System SHALL populate the rule editor with the generated pattern
5. WHEN serializing generated patterns THEN the System SHALL validate the regex syntax before saving
6. WHEN deserializing pattern data THEN the System SHALL validate the regex syntax and report errors clearly

### Requirement 4

**User Story:** As a user, I want to manually edit and validate extraction rules, so that I can fine-tune rules for accurate extraction.

#### Acceptance Criteria

1. WHEN the user accesses the rule editor THEN the System SHALL display editable fields for pattern name, subject pattern, regex pattern, and tags
2. WHEN the user modifies any rule field THEN the System SHALL update the rule preview in real-time
3. WHEN the user clicks "Validate Rule" THEN the System SHALL test the regex against the current email preview and display matches
4. IF the regex pattern is invalid THEN the System SHALL display a clear error message indicating the syntax issue
5. WHEN validation succeeds THEN the System SHALL highlight matched content in the email preview
6. WHEN the user clicks "Save Rule" THEN the System SHALL persist the rule with pattern name, subject pattern, regex pattern, and tags
7. WHEN serializing rule data THEN the System SHALL validate all required fields are present before saving
8. WHEN deserializing rule data THEN the System SHALL validate all required fields and report missing fields clearly

### Requirement 5

**User Story:** As a user, I want to apply saved rules to extract discount codes, so that I can efficiently extract codes from multiple emails.

#### Acceptance Criteria

1. WHEN the user clicks "Use Rule" on a saved rule THEN the System SHALL populate the extraction form with the rule's parameters
2. WHEN a rule is applied THEN the System SHALL use the subject pattern to filter emails and the regex pattern to extract codes
3. WHEN extraction is performed THEN the System SHALL display all extracted codes with their source email information
4. WHEN extraction completes THEN the System SHALL update the rule's "last used" timestamp
5. WHEN no matches are found THEN the System SHALL display a clear message indicating no codes were extracted

