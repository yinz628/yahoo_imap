# Implementation Plan

- [x] 1. Set up project structure and dependencies





  - Initialize Node.js project with TypeScript
  - Install dependencies: `imapflow`, `mailparser`, `exceljs`, `better-sqlite3`, `commander`
  - Install dev dependencies: `vitest`, `fast-check`, `typescript`, `@types/node`
  - Configure `tsconfig.json` and `vitest.config.ts`
  - Create directory structure: `src/`, `src/exporters/`
  - _Requirements: All_

- [x] 2. Implement Config Manager





  - [x] 2.1 Create config types and interfaces


    - Define `ExtractorConfig`, `IMAPConfig`, `FetchFilter`, `ExtractionPattern` interfaces
    - _Requirements: 6.1, 6.2_

  - [x] 2.2 Implement ConfigManager class with serialize/deserialize

    - Implement `save()`, `load()`, `validate()`, `serialize()`, `deserialize()` methods
    - Handle JSON parsing errors with clear messages
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 2.3 Write property test for config round-trip

    - **Property 1: Configuration Round-Trip Consistency**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 2.4 Write property test for config validation

    - **Property 11: Config Validation Correctness**
    - **Validates: Requirements 6.4**

- [x] 3. Implement Email Parser





  - [x] 3.1 Create email parser with HTML stripping


    - Implement `parse()` method using `mailparser`
    - Implement `stripHtml()` method to remove HTML tags
    - _Requirements: 3.5, 3.6_

  - [x] 3.2 Write property test for HTML stripping

    - **Property 7: HTML Strip Consistency**
    - **Validates: Requirements 3.6**

- [x] 4. Implement Regex Extractor





  - [x] 4.1 Create RegexExtractor class


    - Implement `extract()` method with named capture group support
    - Implement `extractBatch()` for batch processing
    - Handle extraction errors gracefully
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Write property test for extraction completeness

    - **Property 5: Regex Extraction Completeness**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 4.3 Write property test for named capture groups


    - **Property 6: Named Capture Group Preservation**
    - **Validates: Requirements 3.3**

- [x] 5. Implement Email Fetcher with Filters





  - [x] 5.1 Create EmailFetcher class with filter support


    - Implement `fetch()` as async generator
    - Implement `count()` for progress tracking
    - Support date, sender, subject, folder filters
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.2 Write property tests for filter correctness

    - **Property 2: Date Filter Correctness**
    - **Property 3: Sender Filter Correctness**
    - **Property 4: Subject Filter Correctness**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 6. Implement IMAP Connector






  - [x] 6.1 Create IMAPConnector class

    - Implement `connect()` with Yahoo IMAP settings
    - Implement `disconnect()` and `listFolders()`
    - Handle authentication and connection errors
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 7. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement CSV Exporter





  - [x] 8.1 Create CSVExporter class


    - Implement `export()` method with proper escaping
    - Implement `serialize()` and `deserialize()` for round-trip
    - Include email metadata in output
    - _Requirements: 4.1, 4.4_
  - [x] 8.2 Write property test for CSV round-trip


    - **Property 8: CSV Export Validity**
    - **Validates: Requirements 4.1**

  - [x] 8.3 Write property test for metadata completeness

    - **Property 9: Export Metadata Completeness**
    - **Validates: Requirements 4.4**

- [x] 9. Implement Excel Exporter






  - [x] 9.1 Create ExcelExporter class

    - Implement `export()` method using `exceljs`
    - Include email metadata and proper formatting
    - _Requirements: 4.2, 4.4_

- [x] 10. Implement SQLite Exporter









  - [x] 10.1 Create SQLiteExporter class




    - Implement `export()` method using `better-sqlite3`
    - Create table schema dynamically based on extraction groups
    - Include email metadata
    - _Requirements: 4.3, 4.4_

- [x] 11. Implement Error Handling and Progress
  - [x] 11.1 Create ErrorCollector and progress utilities
    - Implement error collection and summary
    - Implement progress indicator for batch processing
    - Ensure processing continues on individual email failures
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 11.2 Write property test for error resilience



    - **Property 10: Error Resilience**
    - **Validates: Requirements 5.2**

- [x] 12. Implement CLI Interface






  - [x] 12.1 Create CLI with commander

    - Implement `extract` command with all options
    - Implement `config save` and `config load` subcommands
    - Add progress display and summary output
    - _Requirements: All_

- [x] 13. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
