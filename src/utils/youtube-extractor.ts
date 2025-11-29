export interface YouTubeLinkWithMetadata {
  videoId: string;
  datetime: number;
  userId: string | null;
}

export interface MessageData {
  body: string;
  datetime: number;
  userId: string | null;
}

// YouTube URL regex patterns
export const youTubeRegexes: RegExp[] = [
  /youtu\.be\/([\w-]+)/g,
  /youtube\.com\/watch\?.*v=([\w-]+)/g,
];

/**
 * Extracts YouTube video IDs and metadata from a collection of messages
 * @param messages Array of message data with body, datetime, and userId
 * @param regexes Array of regex patterns to match YouTube URLs (optional)
 * @returns Array of YouTube links with metadata
 */
export const extractYouTubeLinksFromMessages = (
  messages: MessageData[],
  regexes: RegExp[] = youTubeRegexes,
): YouTubeLinkWithMetadata[] =>
  messages.flatMap((message) =>
    regexes.flatMap((regex) => {
      regex.lastIndex = 0;
      const links: YouTubeLinkWithMetadata[] = [];
      let match;
      while ((match = regex.exec(message.body)) !== null) {
        links.push({
          videoId: match[1]!,
          datetime: message.datetime,
          userId: message.userId,
        });
      }
      return links;
    }),
  );

/**
 * Checks if a message contains YouTube links
 * @param messageBody The message text to check
 * @param regexes Array of regex patterns to match YouTube URLs (optional)
 * @returns True if the message contains YouTube links
 */
export const hasYouTubeLinks = (
  messageBody: string,
  regexes: RegExp[] = youTubeRegexes,
): boolean =>
  regexes.some((regex) => {
    regex.lastIndex = 0;
    return regex.test(messageBody);
  });

/**
 * Extracts YouTube video IDs from a single message
 * @param messageBody The message text to extract from
 * @param regexes Array of regex patterns to match YouTube URLs (optional)
 * @returns Array of video IDs found in the message
 */
export const extractVideoIdsFromMessage = (
  messageBody: string,
  regexes: RegExp[] = youTubeRegexes,
): string[] =>
  regexes.flatMap((regex) => {
    regex.lastIndex = 0;
    const videoIds: string[] = [];
    let match;
    while ((match = regex.exec(messageBody)) !== null) {
      videoIds.push(match[1]!);
    }
    return videoIds;
  });
