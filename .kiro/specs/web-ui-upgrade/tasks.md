# Implementation Plan

- [x] 1. Set up project infrastructure and dependencies










  - [x] 1.1 Install required dependencies (bcrypt, uuid, fast-check)




    - Add bcrypt for password hashing
    - Add uuid for generating unique IDs
    - Add fast-check for property-based testing
    - _Requirements: 1.6, 4.5_



  - [x] 1.2 Create data directory structure


    - Create `data/` directory for server-side storage
    - Create `data/users/` directory for user-specific data
    - Add `.gitignore` entry for data directory
    - _Requirements: 2.3_

- [x] 2. Implement authentication module





  - [x] 2.1 Create auth.ts with User and Session interfaces


    - Define User interface with id, username, passwordHash, createdAt
    - Define Session interface with userId, token, expiresAt
    - Implement password hashing with bcrypt
    - Implement token generation and validation
    - _Requirements: 1.6, 1.7_


  - [x] 2.2 Write property test for password hashing

    - **Property 2: Password Hashing Security**
    - **Validates: Requirements 1.6**

  - [x] 2.3 Implement register function


    - Validate username uniqueness
    - Hash password before storage
    - Save user to users.json
    - _Requirements: 1.6, 1.7_


  - [x] 2.4 Implement login function
    - Verify username exists
    - Compare password hash
    - Generate session token on success
    - _Requirements: 1.2, 1.3_

  - [x] 2.5 Write property tests for authentication


    - **Property 4: Valid Login Returns Session**
    - **Property 5: Invalid Login Rejected**
    - **Validates: Requirements 1.2, 1.3**

  - [x] 2.6 Implement validateToken and logout functions

    - Validate token and return user
    - Invalidate session on logout
    - _Requirements: 1.4, 1.5_

  - [x] 2.7 Write property tests for session management


    - **Property 6: Session Token Validity**
    - **Property 7: Logout Invalidates Session**
    - **Validates: Requirements 1.4, 1.5**

- [x] 3. Implement storage module





  - [x] 3.1 Create storage.ts with data interfaces


    - Define Mailbox interface
    - Define PatternHistory interface
    - Implement file read/write utilities
    - _Requirements: 2.1, 2.2_



  - [x] 3.2 Write property test for data serialization round-trip
    - **Property 1: Data Serialization Round-Trip**
    - **Validates: Requirements 1.7, 2.5, 4.7, 5.7**

  - [x] 3.3 Implement user data directory management


    - Create user directory on first data save
    - Ensure data isolation between users
    - _Requirements: 2.3_


  - [x] 3.4 Write property test for user data isolation

    - **Property 8: User Data Isolation**
    - **Validates: Requirements 2.3**

  - [x] 3.5 Implement data validation functions


    - Validate Mailbox structure
    - Validate PatternHistory structure
    - Return clear error messages for invalid data
    - _Requirements: 2.4, 4.6, 5.6_


  - [x] 3.6 Write property test for validation rejection

    - **Property 9: Invalid Data Structure Rejection**
    - **Validates: Requirements 2.4, 4.6, 5.6**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement mailbox management






  - [x] 5.1 Implement mailbox CRUD operations in storage.ts

    - getMailboxes(userId): retrieve all mailboxes for user
    - saveMailbox(userId, mailbox): add new mailbox with encrypted password
    - deleteMailbox(userId, mailboxId): remove mailbox
    - _Requirements: 4.1, 4.2, 4.4, 4.5_


  - [x] 5.2 Write property test for mailbox password encryption

    - **Property 3: Mailbox Password Encryption**
    - **Validates: Requirements 4.5**


  - [x] 5.3 Write property test for mailbox CRUD consistency

    - **Property 10: Mailbox CRUD Consistency**
    - **Validates: Requirements 4.1, 4.2, 4.4**

- [x] 6. Implement pattern history management

  - [x] 6.1 Implement pattern CRUD operations in storage.ts
    - getPatterns(userId): retrieve all patterns for user
    - savePattern(userId, pattern): add new pattern
    - deletePattern(userId, patternId): remove pattern
    - _Requirements: 5.2, 5.3, 5.5_

  - [x] 6.2 Write property test for pattern CRUD consistency


    - **Property 11: Pattern History CRUD Consistency**
    - **Validates: Requirements 5.2, 5.3, 5.5**

- [x] 7. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Extend server.ts with authentication APIs







  - [x] 8.1 Add authentication middleware
    - Extract token from Authorization header
    - Validate token and attach user to request
    - Return 401 for invalid/missing tokens
    - _Requirements: 7.2, 7.3_



  - [x] 8.2 Write property test for unauthenticated API rejection
    - **Property 17: Unauthenticated API Rejection**
    - **Validates: Requirements 7.3**


  - [x] 8.3 Implement auth API endpoints

    - POST /api/auth/register
    - POST /api/auth/login
    - POST /api/auth/logout
    - GET /api/auth/me
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 8.4 Write property test for API response format


    - **Property 18: Consistent API Response Format**
    - **Validates: Requirements 7.4**

- [x] 9. Implement mailbox and pattern API endpoints






  - [x] 9.1 Add mailbox management endpoints

    - GET /api/mailboxes - list user mailboxes
    - POST /api/mailboxes - add new mailbox
    - DELETE /api/mailboxes/:id - delete mailbox
    - _Requirements: 4.1, 4.2, 4.4_


  - [x] 9.2 Add pattern history endpoints

    - GET /api/patterns - list user patterns
    - POST /api/patterns - save new pattern
    - DELETE /api/patterns/:id - delete pattern
    - _Requirements: 5.2, 5.3, 5.5_

- [x] 10. Extend email management APIs

  - [x] 10.1 Add email list endpoint without body
    - POST /api/emails/list - return email metadata only
    - Include subject, sender, recipient, date
    - Support pagination with page and pageSize params
    - _Requirements: 6.2, 6.7_

  - [x] 10.2 Write property test for email list without body
    - **Property 12: Email List Without Body**
    - **Validates: Requirements 6.2**

  - [x] 10.3 Write property test for pagination correctness
    - **Property 16: Pagination Correctness**
    - **Validates: Requirements 6.7**

  - [x] 10.4 Enhance email search and delete endpoints
    - POST /api/emails/search - search by subject pattern with count
    - POST /api/emails/batch-delete - delete multiple emails by UID
    - _Requirements: 6.3, 6.5_

  - [x] 10.5 Write property test for email search filtering
    - **Property 13: Email Search Filtering**
    - **Validates: Requirements 6.3**

  - [x] 10.6 Write property test for batch delete
    - **Property 14: Batch Delete Moves to Trash**
    - **Validates: Requirements 6.5**

  - [x] 10.7 Write property test for empty trash

    - **Property 15: Empty Trash Removes All**
    - **Validates: Requirements 6.6**

- [x] 11. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Refactor frontend with login page





  - [x] 12.1 Create login page HTML structure


    - Add login form with username/password fields
    - Add register/login toggle
    - Add error message display area
    - _Requirements: 1.1, 1.2, 1.3_


  - [x] 12.2 Implement login/register JavaScript functions

    - Call /api/auth/login and /api/auth/register
    - Store token in sessionStorage
    - Redirect to main app on success
    - _Requirements: 1.2, 1.3_

- [x] 13. Implement navigation sidebar







  - [x] 13.1 Create sidebar HTML structure





    - Fixed left sidebar with 200px width
    - Three navigation items: 邮箱管理, 提取折扣码, 邮件管理
    - User info and logout button at bottom
    - _Requirements: 3.1, 3.4_


  - [x] 13.2 Implement navigation JavaScript





    - Handle navigation item clicks
    - Show/hide feature modules
    - Highlight active navigation item
    - _Requirements: 3.2, 3.3_

- [x] 14. Implement mailbox management UI

  - [x] 14.1 Create mailbox management module HTML
    - Mailbox list display
    - Add mailbox form
    - Delete mailbox buttons
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 14.2 Implement mailbox management JavaScript

    - Load and display mailboxes from API
    - Add new mailbox with form submission
    - Delete mailbox with confirmation
    - Auto-fill credentials when selecting mailbox
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 15. Update extraction module with pattern history






  - [x] 15.1 Add pattern history UI to extraction module

    - Pattern history list display
    - Save pattern button
    - Apply pattern from history
    - Delete pattern from history
    - _Requirements: 5.2, 5.3, 5.4, 5.5_


  - [x] 15.2 Implement pattern history JavaScript

    - Load patterns from API
    - Save current pattern to history
    - Apply selected pattern to form
    - Delete pattern with confirmation
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] 16. Implement email management UI






  - [x] 16.1 Create email management module HTML

    - Folder list sidebar
    - Email list table with checkboxes
    - Search bar with subject pattern input
    - Batch delete and empty trash buttons
    - Pagination controls
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_



  - [x] 16.2 Implement email management JavaScript





    - Load folders and emails from API
    - Handle folder selection
    - Implement search by subject pattern
    - Handle email selection with checkboxes
    - Implement batch delete with confirmation
    - Implement empty trash with confirmation
    - Handle pagination
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 17. Final integration and testing








  - [x] 17.1 Update API client to include auth token

    - Add Authorization header to all API requests
    - Handle 401 responses by redirecting to login
    - _Requirements: 7.1, 7.2, 7.3_



  - [x] 17.2 Test complete user flow




    - Register new user
    - Login and verify session
    - Add mailbox and connect
    - Save and apply extraction patterns
    - Browse and manage emails
    - Logout and verify session invalidation
    - _Requirements: All_

- [x] 18. Final Checkpoint - Ensure all tests pass










  - Ensure all tests pass, ask the user if questions arise.

