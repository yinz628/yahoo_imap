# Implementation Plan

- [x] 1. Extend data models and storage








  - [x] 1.1 Update ExtractionRule interface in types.ts


    - Add patternName, tags fields to existing pattern interface
    - Ensure backward compatibility with existing patterns
    - _Requirements: 1.4, 4.7_

  - [x] 1.2 Write property test for rule serialization round-trip


    - **Property 1: Rule Data Serialization Round-Trip**
    - **Validates: Requirements 1.4, 1.5, 4.7, 4.8**

  - [x] 1.3 Update storage.ts to handle extended rule fields


    - Modify savePattern to include new fields
    - Modify getPatterns to return all fields
    - Add migration for existing patterns without new fields
    - _Requirements: 1.1, 1.2, 4.6_

  - [x] 1.4 Write property test for rule list completeness

    - **Property 2: Rule List Completeness**
    - **Validates: Requirements 1.1, 1.2**


  - [x] 1.5 Write property test for rule deletion consistency
    - **Property 3: Rule Deletion Consistency**
    - **Validates: Requirements 1.3**

- [x] 2. Implement regex generator service






  - [x] 2.1 Create regex-generator.ts with core functions


    - Implement escapeSpecialChars function
    - Implement generateFromTarget function
    - Implement suggestPatterns for common code patterns
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.2 Write property test for regex generation correctness


    - **Property 6: Regex Generation Correctness**
    - **Validates: Requirements 3.1**

  - [x] 2.3 Write property test for special character escaping


    - **Property 7: Special Character Escaping**
    - **Validates: Requirements 3.2**

  - [x] 2.4 Implement regex validation function


    - Validate regex syntax
    - Return clear error messages for invalid patterns
    - _Requirements: 3.5, 3.6, 4.4_


  - [x] 2.5 Write property test for regex validation accuracy





    - **Property 8: Regex Validation Accuracy**
    - **Validates: Requirements 3.5, 3.6, 4.4**

- [x] 3. Implement rule validation service






  - [x] 3.1 Create rule-validator.ts with validation functions


    - Validate required fields (patternName, subjectPattern, regexPattern)
    - Validate field types
    - Return clear error messages
    - _Requirements: 4.7, 4.8_


  - [x] 3.2 Write property test for rule validation completeness

    - **Property 9: Rule Validation Completeness**
    - **Validates: Requirements 4.7, 4.8**

  - [x] 3.3 Implement regex match testing function


    - Test regex against content
    - Return all matches with positions
    - _Requirements: 4.3_

  - [x] 3.4 Write property test for regex match correctness


    - **Property 10: Regex Match Correctness**
    - **Validates: Requirements 4.3**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement email preview search service








  - [x] 5.1 Create email-search.ts with search functions


    - Implement searchInContent function
    - Return all occurrences with positions and context
    - _Requirements: 2.4_

  - [x] 5.2 Write property test for content search completeness




    - **Property 5: Content Search Completeness**
    - **Validates: Requirements 2.4**


  - [x] 5.3 Implement highlight function for matches

    - Generate HTML with highlighted matches
    - Support navigation between matches
    - _Requirements: 2.4_

- [x] 6. Extend API endpoints









  - [x] 6.1 Add regex generation endpoint




    - POST /api/regex/generate - generate regex from target string
    - Return literal pattern and suggestions
    - _Requirements: 3.1, 3.3_


  - [x] 6.2 Add regex validation endpoint
    - POST /api/regex/validate - validate regex syntax
    - Return validation result with error details
    - _Requirements: 3.5, 4.4_


  - [x] 6.3 Add regex test endpoint
    - POST /api/regex/test - test regex against content
    - Return all matches

    - _Requirements: 4.3_

  - [x] 6.4 Add rule usage tracking endpoint
    - PUT /api/patterns/:id/use - update lastUsed timestamp
    - _Requirements: 5.4_


  - [x] 6.5 Write property test for last used timestamp update


    - **Property 13: Last Used Timestamp Update**
    - **Validates: Requirements 5.4**

- [x] 7. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update frontend - Rule history panel




  - [x] 8.1 Add rule history section to extraction module


    - Display saved rules in collapsible panel
    - Show pattern name, subject pattern, tags
    - Add "Use" and "Delete" buttons for each rule
    - _Requirements: 1.1, 1.2, 1.3_


  - [x] 8.2 Implement rule history JavaScript functions


    - Load rules from API on module load
    - Handle rule deletion with confirmation
    - Handle "Use Rule" to populate form
    - _Requirements: 1.1, 1.2, 1.3, 5.1_

- [x] 9. Update frontend - Email preview with search







  - [x] 9.1 Add search box to email preview panel

    - Add search input field with navigation buttons
    - Display match count
    - _Requirements: 2.3, 2.4_


  - [x] 9.2 Implement preview search JavaScript functions
    - Search content and highlight matches
    - Navigate between matches with up/down buttons
    - Enable text selection for rule generation
    - _Requirements: 2.4, 2.5_

- [x] 10. Update frontend - Rule editor panel






  - [x] 10.1 Create rule editor UI section


    - Add target string input with "Generate Rule" button
    - Add editable fields: pattern name, subject pattern, regex, tags
    - Add "Validate", "Save", "Use" buttons
    - _Requirements: 3.4, 4.1, 4.6_

  - [x] 10.2 Implement auto-generate rule JavaScript


    - Call /api/regex/generate with target string
    - Populate regex field with generated pattern
    - Show pattern suggestions
    - _Requirements: 3.1, 3.3, 3.4_

  - [x] 10.3 Implement rule validation JavaScript


    - Call /api/regex/validate to check syntax
    - Call /api/regex/test to show matches in preview
    - Highlight matches in email preview
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 10.4 Implement save rule JavaScript


    - Validate required fields
    - Call POST /api/patterns to save
    - Refresh rule history list
    - _Requirements: 4.6, 4.7_

- [x] 11. Update frontend - Extraction with rules








  - [x] 11.1 Implement "Use Rule" functionality




    - Populate extraction form from saved rule
    - Call PUT /api/patterns/:id/use to update timestamp
    - _Requirements: 5.1, 5.4_

  - [x] 11.2 Update extraction results display


    - Show extracted codes with source email info
    - Display "no matches" message when empty
    - _Requirements: 5.2, 5.3, 5.5_

  - [x] 11.3 Write property test for extraction result completeness

    - **Property 12: Extraction Result Completeness**
    - **Validates: Requirements 5.2, 5.3**

- [x] 12. Final integration and testing




  - [x] 12.1 Test complete workflow


    - Filter emails by subject
    - Preview email and search for target string
    - Generate rule from target
    - Edit and validate rule
    - Save rule to history
    - Use saved rule for extraction
    - _Requirements: All_

  - [x] 12.2 Write property test for subject filter accuracy


    - **Property 4: Subject Filter Accuracy**
    - **Validates: Requirements 2.1**

  - [x] 12.3 Write property test for rule save and retrieve consistency


    - **Property 11: Rule Save and Retrieve Consistency**
    - **Validates: Requirements 4.6**

- [x] 13. Final Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.
