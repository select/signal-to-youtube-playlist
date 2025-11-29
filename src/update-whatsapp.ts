import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { extractYouTubeLinks, createWhatsAppConfig } from "./whatsapp/index.js";
import {
  initializeYouTubeClient,
  getPlaylistVideoIds,
  getVideoInfo,
  addVideoToPlaylist,
  type YouTubeClient,
} from "./youtube/playlist.js";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";

// Load environment variables
config();

interface WhatsAppYouTubeMetadata {
  videoId: string;
  datetime: number;
  userId: string | null;
}

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
const RATE_LIMIT_MS = 1000; // 1 second between requests

// Utility functions
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const validateEnvVars = (): string => {
  if (!PLAYLIST_ID) {
    throw new Error(
      "YOUTUBE_PLAYLIST_ID environment variable is required\n\nAdd to your .env file:\nYOUTUBE_PLAYLIST_ID=your_playlist_id",
    );
  }
  return PLAYLIST_ID;
};

// Logging functions
const log = (message: string) => console.log(message);
const logStep = (step: number, message: string) => log(`\n${step}. ${message}`);
const logProgress = (current: number, total: number, message: string) =>
  log(`[${current}/${total}] ${message}`);

/**
 * Converts WhatsApp extraction result to the required metadata format
 * @param youTubeLinks Array of YouTube links with metadata from WhatsApp
 * @returns Array of metadata in the required format
 */
const convertToMetadataFormat = (
  youTubeLinks: Array<{
    videoId: string;
    datetime: number;
    userId: string | null;
  }>,
): WhatsAppYouTubeMetadata[] =>
  youTubeLinks
    .map((link) => ({
      videoId: link.videoId,
      datetime: link.datetime,
      userId: link.userId,
    }))
    .sort((a, b) => a.datetime - b.datetime);

/**
 * Removes duplicate entries based on videoId, userId, and datetime combination
 * @param metadata Array of YouTube metadata
 * @returns Deduplicated array
 */
const deduplicateMetadata = (
  metadata: WhatsAppYouTubeMetadata[],
): WhatsAppYouTubeMetadata[] => {
  const seen = new Set<string>();
  const deduplicated = metadata.filter((entry) => {
    const key = `${entry.videoId}:${entry.userId}:${entry.datetime}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const duplicatesCount = metadata.length - deduplicated.length;
  if (duplicatesCount > 0) {
    log(`   🔄 Removed ${duplicatesCount} duplicate entries`);
  }

  return deduplicated;
};

/**
 * Saves metadata to JSON file
 * @param metadata Array of YouTube metadata
 * @param outputPath Path to save the JSON file
 */
const saveMetadataToFile = async (
  metadata: WhatsAppYouTubeMetadata[],
  outputPath: string,
): Promise<void> => {
  const jsonData = JSON.stringify(metadata, null, 2);
  await writeFile(outputPath, jsonData, "utf-8");
  log(
    `   💾 Saved ${metadata.length} YouTube links with metadata to ${outputPath}`,
  );
};

/**
 * Validates that the WhatsApp export file path is provided
 */
const getWhatsAppFilePath = (): string => {
  const defaultPath = join(process.cwd(), "data", "WhatsApp-music-group.txt");
  return defaultPath;
};

/**
 * Extracts YouTube links from WhatsApp export file
 * @param filePath Path to the WhatsApp export file
 * @returns Extraction results
 */
const extractWhatsAppData = async (filePath: string) => {
  const config = createWhatsAppConfig(filePath, {
    onlyYouTubeMessages: true,
    parseOptions: {
      skipSystemMessages: true,
    },
  });

  return extractYouTubeLinks(filePath, config);
};

// Video addition result types
interface AddResult {
  status: "added" | "skipped" | "error";
  videoId: string;
  message: string;
  title?: string;
}

// Blacklist functionality
interface VideoBlacklist {
  description: string;
  videoIds: string[];
}

const loadVideoBlacklist = async (): Promise<Set<string>> => {
  try {
    const blacklistPath = join(process.cwd(), "data", "video-blacklist.json");
    const blacklistText = await readFile(blacklistPath, "utf-8");
    const blacklist: VideoBlacklist = JSON.parse(blacklistText);
    return new Set(blacklist.videoIds);
  } catch (error) {
    log("   ⚠️  Could not load video blacklist, continuing without filtering");
    return new Set();
  }
};

// Data processing
const findNewVideos = (
  whatsappVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
): string[] =>
  whatsappVideoIds.filter(
    (id) => !existingVideoIds.has(id) && !blacklistedVideoIds.has(id),
  );

const handleBlacklistedVideo = (videoId: string): AddResult => ({
  status: "skipped",
  videoId,
  message: `🚫 Video ${videoId} is blacklisted - skipping`,
});

const handleVideoNotFound = (videoId: string): AddResult => ({
  status: "skipped",
  videoId,
  message: `⚠️  Video ${videoId} not found - skipping`,
});

const handleDuplicateVideo = (videoId: string): AddResult => ({
  status: "skipped",
  videoId,
  message: `⏭️  Already exists: ${videoId}`,
});

const handlePermissionError = (videoId: string): AddResult => ({
  status: "error",
  videoId,
  message: `❌ Permission denied for ${videoId} - check playlist permissions`,
});

const handleGenericError = (videoId: string, error: string): AddResult => ({
  status: "error",
  videoId,
  message: `❌ Error adding ${videoId}: ${error}`,
});

const handleSuccessfulAdd = (videoId: string, title: string): AddResult => ({
  status: "added",
  videoId,
  message: `✅ Added: ${title}`,
  title,
});

const processVideoAddition = async (
  client: YouTubeClient,
  playlistId: string,
  videoId: string,
  blacklistedVideoIds: Set<string>,
): Promise<AddResult> => {
  // Check if video is blacklisted
  if (blacklistedVideoIds.has(videoId)) {
    return handleBlacklistedVideo(videoId);
  }

  try {
    const videoInfo = await getVideoInfo(client, videoId);

    if (!videoInfo) {
      return handleVideoNotFound(videoId);
    }

    await addVideoToPlaylist(client, playlistId, videoId);
    return handleSuccessfulAdd(videoId, videoInfo.snippet?.title || videoId);
  } catch (error: any) {
    if (error.code === 409 || error.message?.includes("duplicate")) {
      return handleDuplicateVideo(videoId);
    }
    if (error.code === 403) {
      return handlePermissionError(videoId);
    }
    return handleGenericError(videoId, error.message);
  }
};

const addVideoWithRateLimit = async (
  client: YouTubeClient,
  playlistId: string,
  videoId: string,
  index: number,
  total: number,
  blacklistedVideoIds: Set<string>,
): Promise<AddResult> => {
  const result = await processVideoAddition(
    client,
    playlistId,
    videoId,
    blacklistedVideoIds,
  );
  logProgress(index + 1, total, result.message);

  if (index < total - 1) {
    await sleep(RATE_LIMIT_MS);
  }

  return result;
};

// Sequential version with proper rate limiting
const addVideosSequentially = async (
  client: YouTubeClient,
  playlistId: string,
  videoIds: string[],
  blacklistedVideoIds: Set<string>,
): Promise<AddResult[]> => {
  const results: AddResult[] = [];

  const addNext = async (index: number): Promise<AddResult[]> => {
    if (index >= videoIds.length) return results;

    const result = await addVideoWithRateLimit(
      client,
      playlistId,
      videoIds[index]!,
      index,
      videoIds.length,
      blacklistedVideoIds,
    );
    results.push(result);

    return addNext(index + 1);
  };

  return addNext(0);
};

// Statistics
interface Stats {
  totalWhatsAppVideos: number;
  previouslyInPlaylist: number;
  blacklistedVideos: number;
  newVideosAdded: number;
  skipped: number;
  errors: number;
  finalPlaylistSize: number;
}

const calculateStats = (
  whatsappVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
  results: AddResult[],
): Stats => ({
  totalWhatsAppVideos: whatsappVideoIds.length,
  previouslyInPlaylist: existingVideoIds.size,
  blacklistedVideos: results.filter((r) => r.message.includes("blacklisted"))
    .length,
  newVideosAdded: results.filter((r) => r.status === "added").length,
  skipped: results.filter(
    (r) => r.status === "skipped" && !r.message.includes("blacklisted"),
  ).length,
  errors: results.filter((r) => r.status === "error").length,
  finalPlaylistSize:
    existingVideoIds.size + results.filter((r) => r.status === "added").length,
});

const printStats = (stats: Stats): void => {
  log("\n📊 Summary:");
  log(`   Total WhatsApp videos: ${stats.totalWhatsAppVideos}`);
  log(`   Previously in playlist: ${stats.previouslyInPlaylist}`);
  log(`   Blacklisted videos: ${stats.blacklistedVideos}`);
  log(`   New videos added: ${stats.newVideosAdded}`);
  log(`   Skipped (not found/duplicate): ${stats.skipped}`);
  log(`   Errors: ${stats.errors}`);
  log(`   Final playlist size: ${stats.finalPlaylistSize}`);
};

const checkForErrors = (stats: Stats): void => {
  if (stats.errors > 0) {
    log("\n⚠️  Some videos failed to add. Check errors above.");
    process.exit(1);
  }
};

/**
 * Prints extraction statistics
 * @param totalMessages Total messages processed
 * @param youTubeMessages Messages containing YouTube links
 * @param finalMetadataCount Final count after deduplication
 * @param errors Number of errors encountered
 */
const printExtractionStats = (
  totalMessages: number,
  youTubeMessages: number,
  finalMetadataCount: number,
  errors: number,
): void => {
  log("\n📊 Extraction Summary:");
  log(`   Total messages processed: ${totalMessages}`);
  log(`   Messages with YouTube links: ${youTubeMessages}`);
  log(`   Unique YouTube links extracted: ${finalMetadataCount}`);
  log(`   Errors encountered: ${errors}`);
};

// Main workflow functions
const loadExistingVideos = async (
  client: YouTubeClient,
  playlistId: string,
) => {
  logStep(4, "📋 Loading existing videos from YouTube playlist...");
  const videoIds = await getPlaylistVideoIds(client, playlistId);
  log(`   Found ${videoIds.size} videos in playlist`);
  return videoIds;
};

const loadBlacklist = async () => {
  logStep(5, "🚫 Loading video blacklist...");
  const blacklistedVideoIds = await loadVideoBlacklist();
  log(`   Found ${blacklistedVideoIds.size} blacklisted videos`);
  return blacklistedVideoIds;
};

const checkNewVideos = (
  whatsappVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
) => {
  logStep(6, "🔍 Checking for new videos...");
  const newVideoIds = findNewVideos(
    whatsappVideoIds,
    existingVideoIds,
    blacklistedVideoIds,
  );

  const blacklistedCount = whatsappVideoIds.filter((id) =>
    blacklistedVideoIds.has(id),
  ).length;

  if (blacklistedCount > 0) {
    log(`   Found ${blacklistedCount} blacklisted videos (will be skipped)`);
  }

  if (newVideoIds.length === 0) {
    log("   ✨ Playlist is already up to date!");
    return null;
  }

  log(`   Found ${newVideoIds.length} new videos to add`);
  return newVideoIds;
};

const addNewVideos = async (
  client: YouTubeClient,
  playlistId: string,
  newVideoIds: string[],
  blacklistedVideoIds: Set<string>,
) => {
  logStep(7, "➕ Adding new videos to playlist...");
  return addVideosSequentially(
    client,
    playlistId,
    newVideoIds,
    blacklistedVideoIds,
  );
};

/**
 * Handles errors and provides helpful messages
 * @param error The error that occurred
 */
const handleError = (error: any): never => {
  console.error("\n❌ Fatal error:", error.message);

  if (error.message.includes("Cannot read WhatsApp export file")) {
    log("\n💡 Make sure the WhatsApp export file exists:");
    log("   Expected location: data/WhatsApp-music-group.txt");
    log("   Export your WhatsApp chat and place it in the data directory");
  } else if (error.message.includes("ENOENT")) {
    log("\n💡 File not found. Check the file path and try again.");
  } else if (
    error.message.includes("not initialized") ||
    error.path?.includes("token.json")
  ) {
    log("\n💡 Please authenticate with YouTube first:");
    log("   pnpm tsx src/youtube/auth.ts");
  } else if (error.message.includes("YOUTUBE_PLAYLIST_ID")) {
    log("\n💡 Add YOUTUBE_PLAYLIST_ID to your .env file:");
    log("   YOUTUBE_PLAYLIST_ID=PLxxxxxxxxxxxx");
  }

  process.exit(1);
};

/**
 * Main function to extract WhatsApp data, save to JSON, and upload to YouTube playlist
 */
const updateWhatsApp = async (): Promise<void> => {
  log("📱 WhatsApp Music Group - Data Extractor & Playlist Updater");
  log("=============================================================");

  try {
    const whatsAppFilePath = getWhatsAppFilePath();
    const playlistId = validateEnvVars();

    logStep(1, "📁 Extracting YouTube links from WhatsApp export...");
    log(`   Reading file: ${whatsAppFilePath}`);

    const result = await extractWhatsAppData(whatsAppFilePath);

    log(`   Found ${result.youTubeLinks.length} YouTube links`);
    log(`   Processed ${result.totalMessages} messages`);

    if (result.errors.length > 0) {
      log(`   ⚠️  Encountered ${result.errors.length} parsing errors`);
      if (result.errors.length <= 5) {
        result.errors.forEach((error) => log(`      ${error}`));
      } else {
        result.errors.slice(0, 3).forEach((error) => log(`      ${error}`));
        log(`      ... and ${result.errors.length - 3} more errors`);
      }
    }

    logStep(2, "🔄 Processing and deduplicating metadata...");
    const metadata = convertToMetadataFormat(result.youTubeLinks);
    const deduplicatedMetadata = deduplicateMetadata(metadata);

    logStep(3, "💾 Saving metadata to file...");
    const outputPath = join(
      process.cwd(),
      "data",
      "youtube_links_metadata_whatsapp.json",
    );
    await saveMetadataToFile(deduplicatedMetadata, outputPath);

    log("\n✨ WhatsApp data extraction complete!");
    printExtractionStats(
      result.totalMessages,
      result.youTubeMessages,
      deduplicatedMetadata.length,
      result.errors.length,
    );

    // Show sample of extracted data
    if (deduplicatedMetadata.length > 0) {
      log("\n📋 Sample extracted data:");
      const sample = deduplicatedMetadata.slice(0, 3);
      sample.forEach((entry, index) => {
        const date = new Date(entry.datetime).toLocaleString();
        log(`   ${index + 1}. Video: ${entry.videoId}`);
        log(`      User: ${entry.userId || "Unknown"}`);
        log(`      Date: ${date}`);
      });

      if (deduplicatedMetadata.length > 3) {
        log(`   ... and ${deduplicatedMetadata.length - 3} more entries`);
      }
    }

    // YouTube playlist upload functionality
    if (deduplicatedMetadata.length === 0) {
      log("\n🎵 No videos to upload to YouTube playlist");
      return;
    }

    log("\n🎵 Starting YouTube playlist upload...");
    log("=====================================");

    const client = await initializeYouTubeClient();
    const whatsappVideoIds = [
      ...new Set(deduplicatedMetadata.map((link) => link.videoId)),
    ];

    const existingVideoIds = await loadExistingVideos(client, playlistId);
    const blacklistedVideoIds = await loadBlacklist();
    const newVideoIds = checkNewVideos(
      whatsappVideoIds,
      existingVideoIds,
      blacklistedVideoIds,
    );

    if (!newVideoIds) {
      const stats = calculateStats(
        whatsappVideoIds,
        existingVideoIds,
        blacklistedVideoIds,
        [],
      );
      log("");
      printStats(stats);
      return;
    }

    const uploadResults = await addNewVideos(
      client,
      playlistId,
      newVideoIds,
      blacklistedVideoIds,
    );

    log("\n✨ YouTube playlist update complete!");
    const stats = calculateStats(
      whatsappVideoIds,
      existingVideoIds,
      blacklistedVideoIds,
      uploadResults,
    );
    printStats(stats);
    checkForErrors(stats);
  } catch (error: any) {
    handleError(error);
  }
};

// Run the update
updateWhatsApp().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
