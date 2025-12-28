// Email Fetcher - Fetches emails from IMAP server with filter support
import type { FetchFilter, RawEmail } from './types.js';
import type { ImapFlow, FetchMessageObject, SearchObject } from 'imapflow';

/**
 * Normalize special quote characters to standard ASCII equivalents.
 * This helps with IMAP search compatibility across different email servers.
 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")  // Various single quotes → '
    .replace(/[\u201C\u201D]/g, '"')               // Curly double quotes → "
    .replace(/[\u2013\u2014]/g, '-');              // En/em dashes → -
}

/**
 * Generate multiple subject search variants to handle different quote encodings.
 * Some email servers store special quotes, others store regular quotes.
 */
function getSubjectVariants(subject: string): string[] {
  const variants = new Set<string>();
  
  // Original
  variants.add(subject);
  
  // Normalized (special → regular)
  variants.add(normalizeQuotes(subject));
  
  // Convert regular quotes to special (right single quote is most common)
  variants.add(subject.replace(/'/g, '\u2019'));
  
  // Normalized then convert to special
  variants.add(normalizeQuotes(subject).replace(/'/g, '\u2019'));
  
  return [...variants];
}

/**
 * EmailFetcher fetches emails from an IMAP connection with filter support.
 * Supports filtering by date range, sender, subject, and folder.
 */
export class EmailFetcher {
  /**
   * Build IMAP search criteria from FetchFilter.
   * Converts our filter format to IMAP search query format.
   * 
   * @param filter - The fetch filter to convert
   * @param subjectOverride - Optional subject override for variant searching
   * @returns IMAP search object
   */
  buildSearchCriteria(filter: FetchFilter, subjectOverride?: string): SearchObject {
    const criteria: SearchObject = {};

    // Date range filters
    if (filter.dateFrom) {
      criteria.since = filter.dateFrom;
    }
    if (filter.dateTo) {
      criteria.before = filter.dateTo;
    }

    // Sender filter - uses FROM search
    if (filter.sender) {
      criteria.from = filter.sender;
    }

    // Subject filter - uses SUBJECT search
    if (subjectOverride !== undefined) {
      criteria.subject = subjectOverride;
    } else if (filter.subject) {
      criteria.subject = normalizeQuotes(filter.subject);
    }

    return criteria;
  }

  /**
   * Get the folder name from filter, defaulting to INBOX.
   * 
   * @param filter - The fetch filter
   * @returns Folder name to use
   */
  getFolder(filter: FetchFilter): string {
    return filter.folder || 'INBOX';
  }

  /**
   * Count the number of emails matching the filter criteria.
   * Useful for progress tracking.
   * Tries multiple subject variants to handle different quote encodings.
   * 
   * @param connection - Active IMAP connection
   * @param filter - Filter criteria
   * @returns Number of matching emails
   */
  async count(connection: ImapFlow, filter: FetchFilter): Promise<number> {
    const folder = this.getFolder(filter);
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });

    try {
      // If no subject filter, use standard search
      if (!filter.subject) {
        const searchCriteria = this.buildSearchCriteria(filter);
        
        // If no filters specified, return total message count
        if (Object.keys(searchCriteria).length === 0) {
          const status = await connection.status(folder, { messages: true });
          return status.messages || 0;
        }

        const uids = await connection.search(searchCriteria, { uid: true });
        return uids === false ? 0 : uids.length;
      }
      
      // Try multiple subject variants to handle different quote encodings
      const subjectVariants = getSubjectVariants(filter.subject);
      const allUids = new Set<number>();
      
      for (const variant of subjectVariants) {
        const searchCriteria = this.buildSearchCriteria(filter, variant);
        const uids = await connection.search(searchCriteria, { uid: true });
        if (uids && uids.length > 0) {
          uids.forEach(uid => allUids.add(uid));
        }
      }
      
      return allUids.size;
    } finally {
      // Close the mailbox
      await connection.mailboxClose();
    }
  }

  /**
   * Fetch emails matching the filter criteria as an async generator.
   * Yields RawEmail objects one at a time for memory efficiency.
   * Tries multiple subject variants to handle different quote encodings.
   * 
   * IMPORTANT: When breaking out of the loop early, the mailbox will be closed
   * automatically. However, if you need to perform another operation immediately
   * after, you may need to wait a moment for the connection to stabilize.
   * 
   * @param connection - Active IMAP connection
   * @param filter - Filter criteria
   * @yields RawEmail objects
   */
  async *fetch(connection: ImapFlow, filter: FetchFilter): AsyncGenerator<RawEmail> {
    const folder = this.getFolder(filter);
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });

    try {
      // Determine which messages to fetch
      let range: string;
      
      // Check if we have any filters
      const hasSubjectFilter = !!filter.subject;
      const baseSearchCriteria = this.buildSearchCriteria({ ...filter, subject: undefined });
      const hasOtherFilters = Object.keys(baseSearchCriteria).length > 0;
      
      if (!hasSubjectFilter && !hasOtherFilters) {
        // No filters - fetch all messages
        range = '1:*';
      } else if (hasSubjectFilter) {
        // Try multiple subject variants to handle different quote encodings
        const subjectVariants = getSubjectVariants(filter.subject!);
        const allUids = new Set<number>();
        
        for (const variant of subjectVariants) {
          const searchCriteria = this.buildSearchCriteria(filter, variant);
          const uids = await connection.search(searchCriteria, { uid: true });
          if (uids && uids.length > 0) {
            uids.forEach(uid => allUids.add(uid));
          }
        }
        
        if (allUids.size === 0) {
          return; // No matching messages
        }
        range = [...allUids].join(',');
      } else {
        // Only other filters, no subject
        const searchCriteria = this.buildSearchCriteria(filter);
        const uids = await connection.search(searchCriteria, { uid: true });
        if (uids === false || uids.length === 0) {
          return; // No matching messages
        }
        range = uids.join(',');
      }

      // Fetch messages with required fields
      const fetchOptions = {
        uid: true,
        envelope: true,
        source: true,
      };

      const useUid = hasSubjectFilter || hasOtherFilters;
      for await (const message of connection.fetch(range, fetchOptions, { uid: useUid })) {
        const rawEmail = this.messageToRawEmail(message);
        if (rawEmail) {
          yield rawEmail;
        }
      }
    } finally {
      // Close the mailbox
      // Note: This may hang if the fetch was interrupted. Use a timeout.
      try {
        const closePromise = connection.mailboxClose();
        const timeoutPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            console.warn('[Fetcher] Mailbox close timed out, continuing...');
            resolve();
          }, 5000);
        });
        await Promise.race([closePromise, timeoutPromise]);
      } catch (error) {
        console.warn('[Fetcher] Mailbox close error:', error instanceof Error ? error.message : 'Unknown');
      }
    }
  }

  /**
   * Fetch a limited number of emails matching the filter criteria.
   * This is safer than using fetch() with a break statement.
   * 
   * @param connection - Active IMAP connection
   * @param filter - Filter criteria
   * @param limit - Maximum number of emails to fetch
   * @returns Array of RawEmail objects
   */
  async fetchLimited(connection: ImapFlow, filter: FetchFilter, limit: number): Promise<RawEmail[]> {
    const folder = this.getFolder(filter);
    const results: RawEmail[] = [];
    
    // Open the mailbox in read-only mode
    await connection.mailboxOpen(folder, { readOnly: true });

    try {
      const searchCriteria = this.buildSearchCriteria(filter);
      
      // Search for matching UIDs
      let uids: number[] | false;
      if (Object.keys(searchCriteria).length === 0) {
        // No filters - get all UIDs
        uids = await connection.search({}, { uid: true });
      } else {
        uids = await connection.search(searchCriteria, { uid: true });
      }
      
      if (uids === false || uids.length === 0) {
        return results;
      }

      // Limit the UIDs
      const limitedUids = uids.slice(0, limit);
      const range = limitedUids.join(',');

      // Fetch messages with required fields
      const fetchOptions = {
        uid: true,
        envelope: true,
        source: true,
      };

      for await (const message of connection.fetch(range, fetchOptions, { uid: true })) {
        const rawEmail = this.messageToRawEmail(message);
        if (rawEmail) {
          results.push(rawEmail);
        }
      }
    } finally {
      // Close the mailbox
      await connection.mailboxClose();
    }

    return results;
  }

  /**
   * Convert an IMAP FetchMessageObject to our RawEmail format.
   * 
   * @param message - IMAP message object
   * @returns RawEmail or null if conversion fails
   */
  private messageToRawEmail(message: FetchMessageObject): RawEmail | null {
    try {
      const envelope = message.envelope;
      if (!envelope) {
        return null;
      }

      // Extract sender address
      const fromAddr = envelope.from?.[0];
      const from = fromAddr?.address || fromAddr?.name || '';

      // Get the raw source as string
      const source = message.source;
      const body = source ? source.toString('utf-8') : '';

      return {
        uid: message.uid,
        date: envelope.date || new Date(),
        from,
        subject: envelope.subject || '',
        body,
        html: undefined, // HTML will be extracted by parser
      };
    } catch (error) {
      console.warn(`Failed to convert message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }
}

/**
 * Filter emails in memory based on FetchFilter criteria.
 * This is useful for testing and for additional filtering beyond IMAP capabilities.
 * 
 * @param emails - Array of RawEmail to filter
 * @param filter - Filter criteria
 * @returns Filtered array of RawEmail
 */
export function filterEmails(emails: RawEmail[], filter: FetchFilter): RawEmail[] {
  return emails.filter(email => {
    // Date range filter
    if (filter.dateFrom && email.date < filter.dateFrom) {
      return false;
    }
    if (filter.dateTo && email.date > filter.dateTo) {
      return false;
    }

    // Sender filter - case-insensitive substring match
    if (filter.sender) {
      const senderLower = filter.sender.toLowerCase();
      const fromLower = email.from.toLowerCase();
      if (!fromLower.includes(senderLower)) {
        return false;
      }
    }

    // Subject filter - case-insensitive substring match with quote normalization
    if (filter.subject) {
      const subjectFilterLower = normalizeQuotes(filter.subject).toLowerCase();
      const subjectLower = normalizeQuotes(email.subject).toLowerCase();
      if (!subjectLower.includes(subjectFilterLower)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * EmailDeleter handles batch deletion of emails.
 */
export class EmailDeleter {
  /**
   * Get UIDs of emails matching the filter criteria.
   * 
   * @param connection - Active IMAP connection
   * @param filter - Filter criteria
   * @returns Array of UIDs
   */
  async getMatchingUIDs(connection: ImapFlow, filter: FetchFilter): Promise<number[]> {
    const folder = filter.folder || 'INBOX';
    
    await connection.mailboxOpen(folder, { readOnly: true });

    try {
      const criteria: SearchObject = {};
      
      if (filter.dateFrom) {
        criteria.since = filter.dateFrom;
      }
      if (filter.dateTo) {
        criteria.before = filter.dateTo;
      }
      if (filter.sender) {
        criteria.from = filter.sender;
      }
      if (filter.subject) {
        criteria.subject = filter.subject;
      }

      const uids = await connection.search(criteria, { uid: true });
      if (uids === false) {
        return [];
      }
      return uids;
    } finally {
      await connection.mailboxClose();
    }
  }

  /**
   * Delete emails by moving them to Trash folder.
   * For Gmail, uses messageMove to [Gmail]/Trash.
   * For Yahoo and other providers, uses messageMove to Trash folder.
   * 
   * @param connection - Active IMAP connection
   * @param filter - Filter criteria for emails to delete
   * @param onProgress - Optional callback for progress updates
   * @returns Number of emails deleted
   */
  async deleteEmails(
    connection: ImapFlow, 
    filter: FetchFilter,
    onProgress?: (deleted: number, total: number) => void
  ): Promise<{ deleted: number; errors: number }> {
    const folder = filter.folder || 'INBOX';
    
    // First get matching UIDs
    const uids = await this.getMatchingUIDs(connection, filter);
    
    if (uids.length === 0) {
      return { deleted: 0, errors: 0 };
    }

    // Get trash folder name for this provider
    const trashFolder = await this.getTrashFolderName(connection);
    
    console.log(`[Deleter] Trash folder: ${trashFolder}`);

    if (!trashFolder) {
      console.error('[Deleter] Could not find Trash folder, aborting delete');
      return { deleted: 0, errors: uids.length };
    }

    // Open mailbox in write mode
    await connection.mailboxOpen(folder, { readOnly: false });

    let deleted = 0;
    let errors = 0;

    try {
      // Process in batches of 50 to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        const range = batch.join(',');
        
        try {
          // Always use messageMove to Trash folder (safer than messageDelete)
          await connection.messageMove(range, trashFolder, { uid: true });
          console.log(`[Deleter] Moved ${batch.length} emails to ${trashFolder}`);
          deleted += batch.length;
          
          if (onProgress) {
            onProgress(deleted, uids.length);
          }
        } catch (error) {
          console.error(`[Deleter] Error deleting batch: ${error instanceof Error ? error.message : 'Unknown'}`);
          errors += batch.length;
        }
      }
    } finally {
      await connection.mailboxClose();
    }

    return { deleted, errors };
  }

  /**
   * Get the trash folder name for the current connection.
   * Different email providers use different folder names.
   * 
   * @param connection - Active IMAP connection
   * @returns Trash folder name or null if not found
   */
  async getTrashFolderName(connection: ImapFlow): Promise<string | null> {
    // Common trash folder names for different providers
    // Note: Trash = deleted emails folder, NOT spam/junk folder
    const trashFolderNames = [
      'Trash',                    // Yahoo, generic
      '[Gmail]/Trash',            // Gmail English
      '[Gmail]/已删除邮件',        // Gmail Chinese (Deleted Mail)
      '[Gmail]/垃圾桶',            // Gmail Chinese (Trash Can)
      '[Gmail]/Papelera',         // Gmail Spanish
      '[Gmail]/Corbeille',        // Gmail French
      'Deleted Items',            // Outlook
      'Deleted Messages',         // Apple Mail
      'INBOX.Trash',              // Some IMAP servers
    ];

    try {
      const folders = await connection.list();
      const folderPaths = folders.map(f => f.path);
      
      // Find the first matching trash folder
      for (const trashName of trashFolderNames) {
        if (folderPaths.includes(trashName)) {
          return trashName;
        }
      }
      
      // Try to find any folder with "trash" or "deleted" in the name (case-insensitive)
      // Note: Exclude "spam" and "junk" folders as they are different from trash
      for (const folder of folders) {
        const lowerPath = folder.path.toLowerCase();
        if ((lowerPath.includes('trash') || lowerPath.includes('deleted') || lowerPath.includes('垃圾桶') || lowerPath.includes('已删除')) 
            && !lowerPath.includes('spam') && !lowerPath.includes('junk') && !lowerPath.includes('垃圾邮件')) {
          return folder.path;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[Deleter] Error listing folders:', error);
      return null;
    }
  }

  /**
   * Empty the Trash folder (permanently delete all emails in Trash).
   * 
   * @param connection - Active IMAP connection
   * @returns Number of emails permanently deleted
   */
  async emptyTrash(connection: ImapFlow): Promise<{ deleted: number; errors: number }> {
    // Find the trash folder name
    const trashFolder = await this.getTrashFolderName(connection);
    
    if (!trashFolder) {
      console.log('[Deleter] No trash folder found');
      return { deleted: 0, errors: 0 };
    }
    
    console.log(`[Deleter] Using trash folder: ${trashFolder}`);
    
    // Get count of emails in Trash
    const status = await connection.status(trashFolder, { messages: true });
    const totalInTrash = status.messages || 0;
    
    if (totalInTrash === 0) {
      return { deleted: 0, errors: 0 };
    }

    // Open Trash folder in write mode
    await connection.mailboxOpen(trashFolder, { readOnly: false });

    let deleted = 0;
    let errors = 0;

    try {
      // Get all UIDs in Trash
      const uids = await connection.search({}, { uid: true });
      
      if (uids === false || uids.length === 0) {
        return { deleted: 0, errors: 0 };
      }

      // Process in batches
      const batchSize = 100;
      for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        const range = batch.join(',');
        
        try {
          // Permanently delete (EXPUNGE)
          await connection.messageDelete(range, { uid: true });
          deleted += batch.length;
        } catch (error) {
          console.error(`[Deleter] Error emptying trash batch: ${error instanceof Error ? error.message : 'Unknown'}`);
          errors += batch.length;
        }
      }
    } finally {
      await connection.mailboxClose();
    }

    return { deleted, errors };
  }

  /**
   * Get count of emails in Trash folder.
   * 
   * @param connection - Active IMAP connection
   * @returns Number of emails in Trash, or -1 if trash folder not found
   */
  async getTrashCount(connection: ImapFlow): Promise<number> {
    // Find the trash folder name
    const trashFolder = await this.getTrashFolderName(connection);
    
    if (!trashFolder) {
      console.log('[Deleter] No trash folder found');
      return -1; // Return -1 to indicate no trash folder
    }
    
    console.log(`[Deleter] Using trash folder: ${trashFolder}`);
    const status = await connection.status(trashFolder, { messages: true });
    return status.messages || 0;
  }
}
