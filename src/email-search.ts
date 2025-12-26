/**
 * Email Preview Search Service
 * 
 * Provides search functionality for finding target strings within email content.
 * Supports highlighting matches and navigation between occurrences.
 * 
 * Requirements: 2.4
 */

/**
 * Represents a search result with position and context
 */
export interface SearchResult {
  index: number;      // Position in the content where match starts
  length: number;     // Length of the matched string
  context: string;    // Surrounding context (text around the match)
}

/**
 * Options for search operations
 */
export interface SearchOptions {
  caseSensitive?: boolean;  // Whether search is case-sensitive (default: false)
  contextLength?: number;   // Number of characters to include as context (default: 30)
}

/**
 * Result of a highlight operation
 */
export interface HighlightResult {
  html: string;           // HTML with highlighted matches
  matchCount: number;     // Total number of matches
  matchPositions: number[]; // Start positions of each match for navigation
}

/**
 * Searches for all occurrences of a query string within content.
 * Returns all matches with their positions and surrounding context.
 * 
 * @param content - The content to search within
 * @param query - The string to search for
 * @param options - Search options (case sensitivity, context length)
 * @returns Array of SearchResult objects with index, length, and context
 * 
 * Requirements: 2.4 - WHEN the user searches in the preview THEN the System SHALL 
 * highlight all matching occurrences and navigate between them
 */
export function searchInContent(
  content: string,
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  // Handle edge cases
  if (!content || !query || query.length === 0) {
    return [];
  }

  const caseSensitive = options.caseSensitive ?? false;
  const contextLength = options.contextLength ?? 30;

  const results: SearchResult[] = [];
  
  // Prepare content and query for searching
  const searchContent = caseSensitive ? content : content.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  let startIndex = 0;
  let foundIndex: number;

  // Find all occurrences
  while ((foundIndex = searchContent.indexOf(searchQuery, startIndex)) !== -1) {
    // Extract context around the match
    const contextStart = Math.max(0, foundIndex - contextLength);
    const contextEnd = Math.min(content.length, foundIndex + query.length + contextLength);
    
    let context = content.substring(contextStart, contextEnd);
    
    // Add ellipsis if context is truncated
    if (contextStart > 0) {
      context = '...' + context;
    }
    if (contextEnd < content.length) {
      context = context + '...';
    }

    results.push({
      index: foundIndex,
      length: query.length,
      context: context,
    });

    // Move to next position (avoid infinite loop for empty matches)
    startIndex = foundIndex + 1;
  }

  return results;
}


/**
 * Escapes HTML special characters to prevent XSS
 * @param text - Text to escape
 * @returns Escaped text safe for HTML insertion
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

/**
 * Generates HTML with highlighted matches for display in email preview.
 * Each match is wrapped in a span with a highlight class and data attribute for navigation.
 * 
 * @param content - The original content to highlight
 * @param query - The string to highlight
 * @param options - Search options (case sensitivity)
 * @returns HighlightResult with HTML, match count, and positions for navigation
 * 
 * Requirements: 2.4 - WHEN the user searches in the preview THEN the System SHALL 
 * highlight all matching occurrences and navigate between them
 */
export function highlightMatches(
  content: string,
  query: string,
  options: SearchOptions = {}
): HighlightResult {
  // Handle edge cases
  if (!content) {
    return {
      html: '',
      matchCount: 0,
      matchPositions: [],
    };
  }

  if (!query || query.length === 0) {
    return {
      html: escapeHtml(content),
      matchCount: 0,
      matchPositions: [],
    };
  }

  const caseSensitive = options.caseSensitive ?? false;
  const searchResults = searchInContent(content, query, { caseSensitive });

  if (searchResults.length === 0) {
    return {
      html: escapeHtml(content),
      matchCount: 0,
      matchPositions: [],
    };
  }

  // Build HTML with highlighted matches
  const htmlParts: string[] = [];
  const matchPositions: number[] = [];
  let lastIndex = 0;

  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    
    // Add text before this match (escaped)
    if (result.index > lastIndex) {
      htmlParts.push(escapeHtml(content.substring(lastIndex, result.index)));
    }

    // Add highlighted match with navigation data attribute
    const matchText = content.substring(result.index, result.index + result.length);
    htmlParts.push(
      `<span class="search-highlight" data-match-index="${i}">${escapeHtml(matchText)}</span>`
    );

    matchPositions.push(result.index);
    lastIndex = result.index + result.length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    htmlParts.push(escapeHtml(content.substring(lastIndex)));
  }

  return {
    html: htmlParts.join(''),
    matchCount: searchResults.length,
    matchPositions: matchPositions,
  };
}

/**
 * Gets the position of a specific match for navigation purposes.
 * 
 * @param matchPositions - Array of match positions from highlightMatches
 * @param currentIndex - Current match index
 * @param direction - 'next' or 'prev' for navigation direction
 * @returns The new match index after navigation, or -1 if no matches
 */
export function navigateMatches(
  matchPositions: number[],
  currentIndex: number,
  direction: 'next' | 'prev'
): number {
  if (matchPositions.length === 0) {
    return -1;
  }

  if (direction === 'next') {
    // Wrap around to first match if at end
    return (currentIndex + 1) % matchPositions.length;
  } else {
    // Wrap around to last match if at beginning
    return currentIndex <= 0 
      ? matchPositions.length - 1 
      : currentIndex - 1;
  }
}
