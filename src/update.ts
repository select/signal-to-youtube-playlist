import {
  initializeYouTubeClient,
  getPlaylistVideoIds,
  getVideoInfo,
  addVideoToPlaylist,
  type YouTubeClient,
} from "./youtube/playlist.js";
import {
  initializeDatabase,
  extractLinksWithMetadata,
  closeDatabase,
  type YouTubeLinkWithMetadata,
} from "./signal/extractor.js";
import { config } from "dotenv";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

// Load environment variables
config();

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
// The frozen, full legacy playlist. Its ids are cached to
// data/legacy-playlist-ids.json (run `pnpm cache:legacy`) and unioned with the
// current playlist's live ids so already-archived videos aren't re-added.
const LEGACY_PLAYLIST_ID =
  process.env.LEGACY_PLAYLIST_ID || "PLHh-DPsAXiAUVUVA9DpRtiYRrwgvqg8Fx";
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

// Data processing
const findNewVideos = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
): string[] =>
  signalVideoIds.filter(
    (id) => !existingVideoIds.has(id) && !blacklistedVideoIds.has(id),
  );

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

const handleBlacklistedVideo = (videoId: string): AddResult => ({
  status: "skipped",
  videoId,
  message: `🚫 Video ${videoId} is blacklisted - skipping`,
});

// Metadata writing functionality
const saveMetadataToFile = async (
  metadata: YouTubeLinkWithMetadata[],
): Promise<void> => {
  const dataPath = join(process.cwd(), "data", "youtube_links_metadata.json");
  const jsonData = JSON.stringify(metadata, null, 2);
  await writeFile(dataPath, jsonData, "utf-8");
  log(
    `   💾 Saved ${metadata.length} YouTube links with metadata to ${dataPath}`,
  );
};

const loadSignalMetadata = async (): Promise<YouTubeLinkWithMetadata[]> => {
  const connection = await initializeDatabase();
  try {
    return extractLinksWithMetadata(connection);
  } finally {
    closeDatabase(connection);
  }
};

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

const handlePermissionError = (videoId: string, reason?: string): AddResult => ({
  status: "error",
  videoId,
  message:
    `❌ Permission denied for ${videoId}` +
    (reason ? ` [${reason}] - check playlist permissions` : " - check playlist permissions"),
});

const handleQuotaError = (videoId: string, reason?: string, message?: string): AddResult => ({
  status: "error",
  videoId,
  message:
    `❌ Quota exceeded for ${videoId}` +
    (reason ? ` [${reason}]` : "") +
    (message ? ` - ${message}` : " - daily quota likely exhausted, retry after midnight PT"),
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
      // YouTube returns 403 for several distinct reasons:
      //   quotaExceeded / dailyLimitExceeded / userRateLimitExceeded -> quota
      //   forbidden / forbiddenAccessory                       -> real permissions
      // googleapis exposes the reason at error.errors[0].reason or
      // error.response.data.error.errors[0].reason. Surface the real one
      // instead of always reporting "permission denied".
      const errors: any[] = error.errors || error.response?.data?.error?.errors || [];
      const reason: string | undefined = errors[0]?.reason;
      const apiMessage: string | undefined = errors[0]?.message;
      const quotaReasons = new Set([
        "quotaExceeded",
        "dailyLimitExceeded",
        "userRateLimitExceeded",
        "rateLimitExceeded",
        "quotaExceededTagger",
      ]);
      if (reason && quotaReasons.has(reason)) {
        return handleQuotaError(videoId, reason, apiMessage);
      }
      return handlePermissionError(videoId, reason);
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
  totalSignalVideos: number;
  previouslyInPlaylist: number;
  blacklistedVideos: number;
  newVideosAdded: number;
  skipped: number;
  errors: number;
  finalPlaylistSize: number;
}

const calculateStats = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
  results: AddResult[],
): Stats => ({
  totalSignalVideos: signalVideoIds.length,
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
  log(`   Total Signal videos: ${stats.totalSignalVideos}`);
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

const loadLegacyPlaylistIds = async (
  client: YouTubeClient,
): Promise<Set<string>> => {
  const cachePath = join(process.cwd(), "data", "legacy-playlist-ids.json");
  try {
    const text = await readFile(cachePath, "utf-8");
    const cache: { videoIds?: string[] } = JSON.parse(text);
    const ids = new Set(cache.videoIds || []);
    log(`   Loaded ${ids.size} legacy ids from cache (${cachePath})`);
    return ids;
  } catch {
    log(
      `   ⚠️  Legacy cache not found at ${cachePath}; fetching legacy playlist ${LEGACY_PLAYLIST_ID} via API (one-time, ~100 quota units)`,
    );
    const ids = await getPlaylistVideoIds(client, LEGACY_PLAYLIST_ID);
    log(`   Fetched ${ids.size} legacy ids from YouTube`);
    log(
      `   💡 Run 'pnpm cache:legacy' to persist this so future runs skip the API fetch.`,
    );
    return ids;
  }
};

// Main workflow
const loadExistingVideos = async (
  client: YouTubeClient,
  playlistId: string,
) => {
  logStep(1, "📋 Loading existing videos...");
  const currentIds = await getPlaylistVideoIds(client, playlistId);
  log(
    `   Found ${currentIds.size} videos in current playlist (${playlistId})`,
  );
  const legacyIds = await loadLegacyPlaylistIds(client);
  const allIds = new Set([...currentIds, ...legacyIds]);
  log(`   Total existing (current + legacy): ${allIds.size}`);
  return allIds;
};

const loadSignalVideos = async () => {
  logStep(2, "📱 Extracting YouTube links from Signal messages...");
  const metadata = await loadSignalMetadata();
  const videoIds = [...new Set(metadata.map((link) => link.videoId))];

  // Save metadata to file
  await saveMetadataToFile(metadata);

  log(`   Found ${videoIds.length} unique videos in Signal`);
  log(`   Found ${metadata.length} total YouTube links with metadata`);
  return videoIds;
};

const loadBlacklist = async () => {
  logStep(3, "🚫 Loading video blacklist...");
  const blacklistedVideoIds = await loadVideoBlacklist();
  log(`   Found ${blacklistedVideoIds.size} blacklisted videos`);
  return blacklistedVideoIds;
};

const checkNewVideos = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
  blacklistedVideoIds: Set<string>,
) => {
  logStep(4, "🔍 Checking for new videos...");
  const newVideoIds = findNewVideos(
    signalVideoIds,
    existingVideoIds,
    blacklistedVideoIds,
  );

  const blacklistedCount = signalVideoIds.filter((id) =>
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
  logStep(5, "➕ Adding new videos to playlist...");
  return addVideosSequentially(
    client,
    playlistId,
    newVideoIds,
    blacklistedVideoIds,
  );
};

const handleError = (error: any): never => {
  console.error("\n❌ Fatal error:", error.message);

  if (
    error.message.includes("not initialized") ||
    error.path?.includes("token.json")
  ) {
    log("\n💡 Please authenticate with YouTube first:");
    log("   pnpm tsx src/youtube/auth.ts");
  } else if (error.message.includes("SIGNAL_GROUP_NAME")) {
    log("\n💡 Add SIGNAL_GROUP_NAME to your .env file:");
    log('   SIGNAL_GROUP_NAME="Music 🎵"');
  } else if (error.message.includes("Conversation")) {
    log("\n💡 Make sure SIGNAL_GROUP_NAME matches exactly:");
    log(`   Current value: "${process.env.SIGNAL_GROUP_NAME}"`);
  } else if (error.message.includes("YOUTUBE_PLAYLIST_ID")) {
    log("\n💡 Add YOUTUBE_PLAYLIST_ID to your .env file:");
    log("   YOUTUBE_PLAYLIST_ID=PLxxxxxxxxxxxx");
  }

  process.exit(1);
};

// Main function
const updatePlaylist = async (): Promise<void> => {
  log("🎵 Signal Music Group - Playlist Updater");
  log("=========================================");

  try {
    const playlistId = validateEnvVars();
    const client = await initializeYouTubeClient();

    const existingVideoIds = await loadExistingVideos(client, playlistId);
    const signalVideoIds = await loadSignalVideos();
    const blacklistedVideoIds = await loadBlacklist();
    const newVideoIds = checkNewVideos(
      signalVideoIds,
      existingVideoIds,
      blacklistedVideoIds,
    );

    if (!newVideoIds) {
      const stats = calculateStats(
        signalVideoIds,
        existingVideoIds,
        blacklistedVideoIds,
        [],
      );
      log("");
      printStats(stats);
      return;
    }

    const results = await addNewVideos(
      client,
      playlistId,
      newVideoIds,
      blacklistedVideoIds,
    );

    log("\n✨ Update complete!");
    const stats = calculateStats(
      signalVideoIds,
      existingVideoIds,
      blacklistedVideoIds,
      results,
    );
    printStats(stats);
    checkForErrors(stats);
  } catch (error: any) {
    handleError(error);
  }
};

// Run the update
updatePlaylist().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
