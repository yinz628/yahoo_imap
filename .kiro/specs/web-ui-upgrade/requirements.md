# Requirements Document

## Introduction

本次升级将 Yahoo Mail Extractor 从单页面应用升级为具有用户认证、服务端数据存储和多功能模块的完整 Web 应用。升级包括：用户登录系统、左侧导航栏、邮箱管理、提取折扣码、邮件管理三大功能模块。所有用户数据将存储在服务端而非浏览器本地存储。

## Glossary

- **User**: 使用本系统的注册用户，通过账号密码登录
- **Session**: 用户登录后的会话状态，用于维持认证状态
- **Mailbox**: 用户添加的 Yahoo 邮箱账户，包含邮箱地址和 App Password
- **Extraction Pattern**: 用于从邮件内容中提取折扣码的正则表达式规则
- **Pattern History**: 保存的邮件主题名和对应的正则规则历史记录
- **Navigation Sidebar**: 网页左侧的功能导航栏，用于切换不同功能模块

## Requirements

### Requirement 1

**User Story:** As a user, I want to register and login with username and password, so that I can securely access my personal data.

#### Acceptance Criteria

1. WHEN a user visits the application without authentication THEN the System SHALL display a login page with username and password fields
2. WHEN a user submits valid login credentials THEN the System SHALL authenticate the user and redirect to the main application
3. IF a user submits invalid credentials THEN the System SHALL display an authentication error message and remain on the login page
4. WHEN a user clicks logout THEN the System SHALL terminate the session and redirect to the login page
5. WHILE a user is authenticated THEN the System SHALL maintain the session state across page refreshes
6. WHEN serializing user credentials THEN the System SHALL hash passwords before storage
7. WHEN deserializing user data THEN the System SHALL validate the data structure and report parsing errors clearly

### Requirement 2

**User Story:** As a user, I want to store my data on the server instead of browser, so that I can access my data from any device.

#### Acceptance Criteria

1. WHEN a user saves any configuration THEN the System SHALL persist the data to server-side JSON files
2. WHEN a user loads the application THEN the System SHALL retrieve user-specific data from server storage
3. WHEN storing user data THEN the System SHALL organize data by user ID in separate directories
4. WHEN serializing configuration data THEN the System SHALL validate the JSON structure before saving
5. WHEN deserializing configuration data THEN the System SHALL validate the JSON structure and report parsing errors clearly

### Requirement 3

**User Story:** As a user, I want a navigation sidebar on the left side, so that I can easily switch between different features.

#### Acceptance Criteria

1. WHEN the user is authenticated THEN the System SHALL display a navigation sidebar on the left side of the page
2. WHEN the user clicks a navigation item THEN the System SHALL switch to the corresponding feature module
3. WHILE a feature module is active THEN the System SHALL highlight the corresponding navigation item
4. WHEN the navigation sidebar is displayed THEN the System SHALL show three main sections: Mailbox Management, Extract Discount Codes, Email Management

### Requirement 4

**User Story:** As a user, I want to manage my saved mailboxes, so that I can easily connect to previously added email accounts.

#### Acceptance Criteria

1. WHEN the user accesses Mailbox Management THEN the System SHALL display a list of saved mailboxes with email addresses
2. WHEN the user adds a new mailbox THEN the System SHALL save the email address and App Password to server storage
3. WHEN the user selects a saved mailbox THEN the System SHALL auto-fill the connection credentials
4. WHEN the user deletes a mailbox THEN the System SHALL remove the mailbox record from server storage
5. WHEN storing mailbox credentials THEN the System SHALL encrypt the App Password before saving
6. WHEN serializing mailbox data THEN the System SHALL validate the data structure before saving
7. WHEN deserializing mailbox data THEN the System SHALL validate the data structure and report parsing errors clearly

### Requirement 5

**User Story:** As a user, I want to extract discount codes from emails and save extraction patterns, so that I can reuse patterns for similar emails.

#### Acceptance Criteria

1. WHEN the user accesses Extract Discount Codes THEN the System SHALL display the existing extraction interface with pattern generation
2. WHEN the user saves an extraction pattern THEN the System SHALL store the subject name and regex pattern to server storage as history
3. WHEN the user views pattern history THEN the System SHALL display all saved subject names and their corresponding regex patterns
4. WHEN the user selects a history pattern THEN the System SHALL apply the saved subject and regex to the current extraction
5. WHEN the user deletes a history pattern THEN the System SHALL remove the pattern record from server storage
6. WHEN serializing pattern history THEN the System SHALL validate the data structure before saving
7. WHEN deserializing pattern history THEN the System SHALL validate the data structure and report parsing errors clearly

### Requirement 6

**User Story:** As a user, I want to browse and manage emails in my mailbox, so that I can view, search, and delete emails efficiently.

#### Acceptance Criteria

1. WHEN the user accesses Email Management THEN the System SHALL display a folder list from the connected mailbox
2. WHEN the user selects a folder THEN the System SHALL display email list with subject, sender, and recipient (without loading email body)
3. WHEN the user searches by subject pattern THEN the System SHALL filter and count matching emails
4. WHEN the user selects multiple emails THEN the System SHALL enable batch delete operation
5. WHEN the user confirms batch delete THEN the System SHALL move selected emails to trash folder
6. WHEN the user clicks empty trash THEN the System SHALL permanently delete all emails in trash folder
7. WHEN displaying email list THEN the System SHALL support pagination for large mailboxes

### Requirement 7

**User Story:** As a developer, I want the frontend and backend to communicate via REST API, so that the system is maintainable and testable.

#### Acceptance Criteria

1. WHEN the frontend requests user data THEN the System SHALL use authenticated REST API endpoints
2. WHEN the backend receives API requests THEN the System SHALL validate the session token before processing
3. IF an API request has an invalid or expired session THEN the System SHALL return a 401 Unauthorized response
4. WHEN the API returns data THEN the System SHALL use consistent JSON response format
5. WHEN serializing API responses THEN the System SHALL validate the JSON structure before sending
6. WHEN deserializing API requests THEN the System SHALL validate the JSON structure and report parsing errors clearly

