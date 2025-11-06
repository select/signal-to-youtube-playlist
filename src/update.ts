import {
  initializeYouTubeClient,
  getPlaylistVideoIds,
  getVideoInfo,
  addVideoToPlaylist,
  type YouTubeClient,
} from "./youtube/playlist.js";
import {
  initializeDatabase,
  getUniqueVideoIds,
  closeDatabase,
} from "./signal/extractor.js";
import { config } from "dotenv";

// Load environment variables
config();

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

// Data processing
const findNewVideos = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
): string[] => signalVideoIds.filter((id) => !existingVideoIds.has(id));

// Video addition result types
interface AddResult {
  status: "added" | "skipped" | "error";
  videoId: string;
  message: string;
  title?: string;
}

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
): Promise<AddResult> => {
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
): Promise<AddResult> => {
  const result = await processVideoAddition(client, playlistId, videoId);
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
  newVideosAdded: number;
  skipped: number;
  errors: number;
  finalPlaylistSize: number;
}

const calculateStats = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
  results: AddResult[],
): Stats => ({
  totalSignalVideos: signalVideoIds.length,
  previouslyInPlaylist: existingVideoIds.size,
  newVideosAdded: results.filter((r) => r.status === "added").length,
  skipped: results.filter((r) => r.status === "skipped").length,
  errors: results.filter((r) => r.status === "error").length,
  finalPlaylistSize:
    existingVideoIds.size + results.filter((r) => r.status === "added").length,
});

const printStats = (stats: Stats): void => {
  log("\n📊 Summary:");
  log(`   Total Signal videos: ${stats.totalSignalVideos}`);
  log(`   Previously in playlist: ${stats.previouslyInPlaylist}`);
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

// Main workflow
const loadExistingVideos = async (
  client: YouTubeClient,
  playlistId: string,
) => {
  logStep(1, "📋 Loading existing videos from YouTube playlist...");
  const videoIds = await getPlaylistVideoIds(client, playlistId);
  log(`   Found ${videoIds.size} videos in playlist`);
  return videoIds;
};

const loadSignalVideos = async () => {
  logStep(2, "📱 Extracting YouTube links from Signal messages...");
  const connection = await initializeDatabase();
  try {
    const videoIds = getUniqueVideoIds(connection);
    log(`   Found ${videoIds.length} unique videos in Signal`);
    return videoIds;
  } finally {
    closeDatabase(connection);
  }
};

const checkNewVideos = (
  signalVideoIds: string[],
  existingVideoIds: Set<string>,
) => {
  logStep(3, "🔍 Checking for new videos...");
  const newVideoIds = findNewVideos(signalVideoIds, existingVideoIds);

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
) => {
  logStep(4, "➕ Adding new videos to playlist...");
  return addVideosSequentially(client, playlistId, newVideoIds);
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
    const newVideoIds = checkNewVideos(signalVideoIds, existingVideoIds);

    if (!newVideoIds) {
      const stats = calculateStats(signalVideoIds, existingVideoIds, []);
      log("");
      printStats(stats);
      return;
    }

    const results = await addNewVideos(client, playlistId, newVideoIds);

    log("\n✨ Update complete!");
    const stats = calculateStats(signalVideoIds, existingVideoIds, results);
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
