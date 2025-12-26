# Requirements Document

## Introduction

本系统是一个 Yahoo Mail 邮件批量提取工具，通过 IMAP 协议连接 Yahoo 邮箱，批量拉取符合条件的邮件，使用正则表达式提取邮件内容中的关键信息，并将结果导出为 CSV、Excel 或数据库格式。

## Glossary

- **IMAP**: Internet Message Access Protocol，互联网邮件访问协议，用于从邮件服务器获取邮件
- **App Password**: Yahoo 为第三方应用生成的专用密码，用于 IMAP 认证
- **Extraction Pattern**: 用于从邮件内容中提取特定信息的正则表达式模式
- **Mail Extractor**: 本系统的核心组件，负责连接邮箱、提取邮件和导出数据

## Requirements

### Requirement 1

**User Story:** As a user, I want to connect to my Yahoo Mail account via IMAP, so that I can access my emails programmatically.

#### Acceptance Criteria

1. WHEN the user provides valid Yahoo email credentials (email and app password) THEN the Mail Extractor SHALL establish a secure IMAP connection to Yahoo Mail server
2. WHEN the IMAP connection is established THEN the Mail Extractor SHALL authenticate using the provided app password
3. IF the credentials are invalid THEN the Mail Extractor SHALL return a clear authentication error message
4. IF the network connection fails THEN the Mail Extractor SHALL return a connection error with retry guidance

### Requirement 2

**User Story:** As a user, I want to filter and fetch emails based on specific criteria, so that I can process only the emails I need.

#### Acceptance Criteria

1. WHEN the user specifies a date range THEN the Mail Extractor SHALL fetch only emails within that date range
2. WHEN the user specifies a sender filter THEN the Mail Extractor SHALL fetch only emails from matching senders
3. WHEN the user specifies a subject filter THEN the Mail Extractor SHALL fetch only emails with matching subjects
4. WHEN the user specifies a folder name THEN the Mail Extractor SHALL fetch emails from that specific folder
5. WHEN no filters are specified THEN the Mail Extractor SHALL fetch all emails from the inbox

### Requirement 3

**User Story:** As a user, I want to extract specific information from email content using regex patterns, so that I can capture the data I need.

#### Acceptance Criteria

1. WHEN the user provides a regex pattern THEN the Mail Extractor SHALL apply the pattern to each email body and extract matching content
2. WHEN multiple matches exist in an email THEN the Mail Extractor SHALL capture all matches
3. WHEN the user provides named capture groups in the regex THEN the Mail Extractor SHALL preserve the group names in the output
4. IF no matches are found in an email THEN the Mail Extractor SHALL include the email in results with empty extraction fields
5. WHEN parsing email content THEN the Mail Extractor SHALL handle both plain text and HTML email formats
6. WHEN extracting from HTML emails THEN the Mail Extractor SHALL provide an option to strip HTML tags before applying regex

### Requirement 4

**User Story:** As a user, I want to export extracted data to various formats, so that I can use the data in different applications.

#### Acceptance Criteria

1. WHEN the user selects CSV export THEN the Mail Extractor SHALL generate a valid CSV file with headers and extracted data
2. WHEN the user selects Excel export THEN the Mail Extractor SHALL generate a valid XLSX file with proper formatting
3. WHEN the user selects database export THEN the Mail Extractor SHALL insert records into the specified SQLite database
4. WHEN exporting data THEN the Mail Extractor SHALL include email metadata (subject, sender, date) alongside extracted content
5. WHEN the export file path already exists THEN the Mail Extractor SHALL prompt for overwrite confirmation or append option

### Requirement 5

**User Story:** As a user, I want to see progress and status during the extraction process, so that I can monitor the operation.

#### Acceptance Criteria

1. WHILE emails are being fetched THEN the Mail Extractor SHALL display a progress indicator showing current count and total
2. WHEN an email fails to process THEN the Mail Extractor SHALL log the error and continue processing remaining emails
3. WHEN the extraction completes THEN the Mail Extractor SHALL display a summary with total processed, successful extractions, and failures

### Requirement 6

**User Story:** As a user, I want to serialize and deserialize extraction configurations, so that I can reuse my settings.

#### Acceptance Criteria

1. WHEN the user saves a configuration THEN the Mail Extractor SHALL serialize the settings to a JSON file
2. WHEN the user loads a configuration THEN the Mail Extractor SHALL deserialize the JSON file and apply the settings
3. WHEN serializing configuration THEN the Mail Extractor SHALL validate the JSON structure before saving
4. WHEN deserializing configuration THEN the Mail Extractor SHALL validate the JSON structure and report parsing errors clearly
