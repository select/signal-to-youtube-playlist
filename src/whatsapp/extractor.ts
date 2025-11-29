import { join, resolve } from "node:path";
import { access, constants } from "node:fs/promises";
import { processFileByLines, procesFileInBatches } from "../utils/file-stream-reader.js";
import { parseWhatsAppLine, parseWhatsAppLines, type WhatsAppMessage, type WhatsAppParseOptions } from "./parser.js";
import { extractYouTubeLinksFromMessages, hasYouTubeLinks, type YouTubeLinkWithMetadata, type MessageData } from "../utils/youtube-extractor.js";

export interface WhatsAppExtractorConfig {
  filePath: string;
  parseOptions?: WhatsAppParseOptions;
  batchSize?: number;
  onlyYouTubeMessages?: boolean;
}

export interface WhatsAppExtractorResult {
  totalMessages: number;
  youTubeMessages: number;
  youTubeLinks: YouTubeLinkWithMetadata[];
  errors: string[];
}

/**
 * Validates that the WhatsApp export file exists and is readable
 * @param filePath Path to the WhatsApp export file
 * @throws Error if file doesn't exist or isn't readable
 */
const validateFile = async (filePath: string): Promise<void> => {
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    throw new Error(`Cannot read WhatsApp export file at ${filePath}: ${error}`);
  }
};

/**
 * Converts WhatsApp message to MessageData format for YouTube extraction
 * @param message Parsed WhatsApp message
 * @returns MessageData object
 */
const whatsAppMessageToMessageData = (message: WhatsAppMessage): MessageData => ({
  body: message.message,
  datetime: message.datetime,
  userId: message.userId,
});

/**
 * Processes a batch of WhatsApp lines and extracts messages with YouTube links
 * @param lines Array of raw lines from WhatsApp export
 * @param parseOptions Options for parsing WhatsApp messages
 * @param onlyYouTubeMessages If true, only return messages containing YouTube links
 * @returns Object with parsed messages and YouTube links
 */
const processBatch = (
  lines: string[],
  parseOptions: WhatsAppParseOptions = {},
  onlyYouTubeMessages: boolean = false,
): { messages: WhatsAppMessage[]; youTubeLinks: YouTubeLinkWithMetadata[]; errors: string[] } => {
  const messages: WhatsAppMessage[] = [];
  const errors: string[] = [];

  // Parse all lines in the batch
  lines.forEach((line, index) => {
    try {
      const message = parseWhatsAppLine(line, index + 1, parseOptions);
      if (message) {
        // Filter for YouTube messages if requested
        if (!onlyYouTubeMessages || hasYouTubeLinks(message.message)) {
          messages.push(message);
        }
      }
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error}`);
    }
  });

  // Extract YouTube links from parsed messages
  const messageData = messages.map(whatsAppMessageToMessageData);
  const youTubeLinks = extractYouTubeLinksFromMessages(messageData);

  return { messages, youTubeLinks, errors };
};

/**
 * Extracts YouTube links from WhatsApp chat export file
 * @param config Configuration for the extraction process
 * @returns Promise resolving to extraction results
 */
export const extractYouTubeLinksBatch = async (
  config: WhatsAppExtractorConfig,
): Promise<WhatsAppExtractorResult> => {
  const {
    filePath,
    parseOptions = {},
    batchSize = 1000,
    onlyYouTubeMessages = false,
  } = config;

  // Validate file exists
  await validateFile(filePath);

  let totalMessages = 0;
  let youTubeMessages = 0;
  const allYouTubeLinks: YouTubeLinkWithMetadata[] = [];
  const allErrors: string[] = [];

  // Process file in batches
  await procesFileInBatches(
    filePath,
    async (batch: string[]) => {
      const { messages, youTubeLinks, errors } = processBatch(
        batch,
        parseOptions,
        onlyYouTubeMessages,
      );

      totalMessages += messages.length;
      youTubeMessages += messages.filter(msg => hasYouTubeLinks(msg.message)).length;
      allYouTubeLinks.push(...youTubeLinks);
      allErrors.push(...errors);

      return []; // We're accumulating results ourselves
    },
    batchSize,
  );

  return {
    totalMessages,
    youTubeMessages,
    youTubeLinks: allYouTubeLinks,
    errors: allErrors,
  };
};

/**
 * Extracts YouTube links from WhatsApp chat export file using line-by-line processing
 * More memory efficient for very large files
 * @param config Configuration for the extraction process
 * @returns Promise resolving to extraction results
 */
export const extractYouTubeLinksStream = async (
  config: WhatsAppExtractorConfig,
): Promise<WhatsAppExtractorResult> => {
  const {
    filePath,
    parseOptions = {},
    onlyYouTubeMessages = false,
  } = config;

  // Validate file exists
  await validateFile(filePath);

  let totalMessages = 0;
  let youTubeMessages = 0;
  const allYouTubeLinks: YouTubeLinkWithMetadata[] = [];
  const allErrors: string[] = [];

  // Process file line by line
  await processFileByLines(
    filePath,
    (line: string, lineNumber: number) => {
      try {
        const message = parseWhatsAppLine(line, lineNumber, parseOptions);
        if (!message) return null;

        const hasYouTube = hasYouTubeLinks(message.message);

        // Skip if we only want YouTube messages and this doesn't have any
        if (onlyYouTubeMessages && !hasYouTube) {
          return null;
        }

        totalMessages++;
        if (hasYouTube) {
          youTubeMessages++;

          // Extract YouTube links from this message
          const messageData = whatsAppMessageToMessageData(message);
          const links = extractYouTubeLinksFromMessages([messageData]);
          allYouTubeLinks.push(...links);
        }

        return message;
      } catch (error) {
        allErrors.push(`Line ${lineNumber}: ${error}`);
        return null;
      }
    },
  );

  return {
    totalMessages,
    youTubeMessages,
    youTubeLinks: allYouTubeLinks,
    errors: allErrors,
  };
};

/**
 * Default extraction function that automatically chooses the best method
 * @param filePath Path to WhatsApp export file
 * @param options Optional configuration
 * @returns Promise resolving to extraction results
 */
export const extractYouTubeLinks = async (
  filePath: string,
  options: Partial<WhatsAppExtractorConfig> = {},
): Promise<WhatsAppExtractorResult> => {
  const config: WhatsAppExtractorConfig = {
    filePath: resolve(filePath),
    parseOptions: {},
    batchSize: 1000,
    onlyYouTubeMessages: true,
    ...options,
  };

  // Use streaming approach for better memory efficiency
  return extractYouTubeLinksStream(config);
};

/**
 * Creates a WhatsApp extractor configuration with default values
 * @param filePath Path to WhatsApp export file
 * @param overrides Optional configuration overrides
 * @returns Complete extractor configuration
 */
export const createWhatsAppConfig = (
  filePath: string,
  overrides: Partial<WhatsAppExtractorConfig> = {},
): WhatsAppExtractorConfig => ({
  filePath: resolve(filePath),
  parseOptions: {
    skipSystemMessages: true,
    ...overrides.parseOptions,
  },
  batchSize: 1000,
  onlyYouTubeMessages: true,
  ...overrides,
});
