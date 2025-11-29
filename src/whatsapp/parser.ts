export interface WhatsAppMessage {
  datetime: number;
  userId: string | null;
  message: string;
  rawLine: string;
}

export interface WhatsAppParseOptions {
  timezone?: string;
  skipSystemMessages?: boolean;
}

/**
 * Regular expression to parse WhatsApp chat export format
 * Matches patterns like:
 * - "25/11/2016, 01:29 - +43 677 61419397: message content"
 * - "26/11/2016, 18:25 - I'm on Signal: message content"
 */
const WHATSAPP_MESSAGE_REGEX = /^(\d{1,2}\/\d{1,2}\/\d{4}),\s(\d{1,2}:\d{2})\s-\s([^:]+):\s(.*)$/;

/**
 * System message patterns that should be filtered out
 */
const SYSTEM_MESSAGE_PATTERNS = [
  /Messages and calls are end-to-end encrypted/,
  /You created group/,
  /added/,
  /left/,
  /changed the group description/,
  /changed the subject/,
  /This message was deleted/,
];

/**
 * Parses a date string in DD/MM/YYYY format and time in HH:MM format
 * @param dateStr Date string like "25/11/2016"
 * @param timeStr Time string like "01:29"
 * @returns Unix timestamp in milliseconds
 */
const parseWhatsAppDateTime = (dateStr: string, timeStr: string): number => {
  const [day, month, year] = dateStr.split('/').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Create date object (month is 0-indexed in JS)
  const date = new Date(year!, month! - 1, day, hours, minutes);
  return date.getTime();
};

/**
 * Determines if a message is a system message
 * @param message The message content to check
 * @returns True if it's a system message
 */
const isSystemMessage = (message: string): boolean =>
  SYSTEM_MESSAGE_PATTERNS.some(pattern => pattern.test(message));

/**
 * Normalizes user identifier by removing common phone number formatting
 * @param userId Raw user identifier from WhatsApp export
 * @returns Normalized user ID or null for system messages
 */
const normalizeUserId = (userId: string): string | null => {
  const trimmedUserId = userId.trim();

  // Check if it's a phone number (starts with +)
  if (trimmedUserId.startsWith('+')) {
    return trimmedUserId.replace(/\s+/g, ''); // Remove spaces
  }

  // For named users, return as-is
  return trimmedUserId || null;
};

/**
 * Parses a single line from WhatsApp chat export
 * @param line Raw line from the chat export file
 * @param lineNumber Line number for error reporting
 * @param options Parsing options
 * @returns Parsed message or null if line doesn't match format
 */
export const parseWhatsAppLine = (
  line: string,
  lineNumber: number,
  options: WhatsAppParseOptions = {},
): WhatsAppMessage | null => {
  const { skipSystemMessages = true } = options;

  // Skip empty lines
  if (!line.trim()) {
    return null;
  }

  const match = line.match(WHATSAPP_MESSAGE_REGEX);
  if (!match) {
    // Line doesn't match expected format - might be continuation of previous message
    return null;
  }

  const [, dateStr, timeStr, userStr, messageContent] = match;

  if (!dateStr || !timeStr || !userStr || messageContent === undefined) {
    throw new Error(`Invalid message format at line ${lineNumber}: ${line}`);
  }

  // Skip system messages if requested
  if (skipSystemMessages && isSystemMessage(messageContent)) {
    return null;
  }

  const datetime = parseWhatsAppDateTime(dateStr, timeStr);
  const userId = normalizeUserId(userStr);

  return {
    datetime,
    userId,
    message: messageContent.trim(),
    rawLine: line,
  };
};

/**
 * Parses multiple lines from WhatsApp chat export
 * @param lines Array of lines from the chat export
 * @param options Parsing options
 * @returns Array of parsed messages
 */
export const parseWhatsAppLines = (
  lines: string[],
  options: WhatsAppParseOptions = {},
): WhatsAppMessage[] =>
  lines
    .map((line, index) => parseWhatsAppLine(line, index + 1, options))
    .filter((message): message is WhatsAppMessage => message !== null);

/**
 * Validates that a parsed message has the expected structure
 * @param message Parsed message to validate
 * @returns True if message is valid
 */
export const isValidWhatsAppMessage = (message: WhatsAppMessage): boolean =>
  typeof message.datetime === 'number' &&
  message.datetime > 0 &&
  typeof message.message === 'string' &&
  message.message.length > 0 &&
  typeof message.rawLine === 'string';
