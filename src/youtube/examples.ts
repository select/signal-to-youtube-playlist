import {
  initializeYouTubeClient,
  getPlaylists,
  getPlaylistVideos,
  addVideoToPlaylist,
  createPlaylist,
  getVideoInfo,
  extractVideoId,
  type YouTubeClient,
} from "./playlist.js";

const log = (message: string) => console.log(message);

// List operations
const formatPlaylistInfo = (playlist: any, index: number): string =>
  `${index + 1}. ${playlist.snippet?.title}\n   ID: ${playlist.id}\n   Videos: ${playlist.contentDetails?.itemCount || 0}\n`;

const formatVideoInfo = (video: any, index: number): string =>
  `${index + 1}. ${video.snippet?.title}\n   Video ID: ${video.contentDetails?.videoId}\n   Published: ${video.snippet?.publishedAt}\n`;

const listPlaylists = async (): Promise<void> => {
  const client = await initializeYouTubeClient();
  log("📋 Your YouTube Playlists:\n");

  const playlists = await getPlaylists(client);
  const formattedPlaylists = playlists.map(formatPlaylistInfo).join("\n");
  log(formattedPlaylists);
};

const listPlaylistVideos = async (playlistId: string): Promise<void> => {
  const client = await initializeYouTubeClient();
  log(`🎵 Videos in playlist:\n`);

  const videos = await getPlaylistVideos(client, playlistId);
  const formattedVideos = videos.map(formatVideoInfo).join("\n");
  log(formattedVideos);
  log(`Total videos: ${videos.length}`);
};

// Add operations
interface AddVideoResult {
  videoId: string;
  status: "success" | "not_found" | "duplicate" | "error";
  message: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const handleVideoAdd = async (
  client: YouTubeClient,
  playlistId: string,
  videoId: string,
): Promise<AddVideoResult> => {
  try {
    const videoInfo = await getVideoInfo(client, videoId);
    if (!videoInfo) {
      return {
        videoId,
        status: "not_found",
        message: `❌ Video ${videoId} not found - skipping`,
      };
    }

    await addVideoToPlaylist(client, playlistId, videoId);
    return {
      videoId,
      status: "success",
      message: `✅ Added: ${videoInfo.snippet?.title}`,
    };
  } catch (error: any) {
    if (error.code === 409) {
      return {
        videoId,
        status: "duplicate",
        message: `⏭️  Video ${videoId} already in playlist - skipping`,
      };
    }
    return {
      videoId,
      status: "error",
      message: `❌ Failed to add ${videoId}: ${error.message}`,
    };
  }
};

const addVideoWithDelay = async (
  client: YouTubeClient,
  playlistId: string,
  videoId: string,
  index: number,
  total: number,
): Promise<AddVideoResult> => {
  const result = await handleVideoAdd(client, playlistId, videoId);
  log(result.message);

  if (index < total - 1) {
    await sleep(500);
  }

  return result;
};

const addVideosSequentially = async (
  client: YouTubeClient,
  playlistId: string,
  videoIds: string[],
  index: number = 0,
  results: AddVideoResult[] = [],
): Promise<AddVideoResult[]> => {
  if (index >= videoIds.length) return results;

  const result = await addVideoWithDelay(
    client,
    playlistId,
    videoIds[index]!,
    index,
    videoIds.length,
  );
  return addVideosSequentially(client, playlistId, videoIds, index + 1, [
    ...results,
    result,
  ]);
};

const addVideosToPlaylist = async (
  playlistId: string,
  videoIds: string[],
): Promise<void> => {
  const client = await initializeYouTubeClient();
  log(`➕ Adding ${videoIds.length} videos to playlist...\n`);

  await addVideosSequentially(client, playlistId, videoIds);
  log("\n✨ Done!");
};

// Create playlist
const createPlaylistWithVideos = async (
  title: string,
  description: string,
  videoIds: string[],
): Promise<string | undefined> => {
  const client = await initializeYouTubeClient();
  log(`📝 Creating playlist: ${title}\n`);

  const playlist = await createPlaylist(client, title, description, "public");
  log(`✅ Playlist created with ID: ${playlist.id}\n`);

  await addVideosToPlaylist(playlist.id!, videoIds);
  return playlist.id;
};

// Extract video IDs
const extractVideoIdsFromUrls = (urls: string[]): string[] => {
  const extracted = urls
    .map((url) => ({
      url,
      id: extractVideoId(url),
    }))
    .filter((result) => {
      if (!result.id) {
        log(`⚠️  Could not extract video ID from: ${result.url}`);
      }
      return result.id !== null;
    })
    .map((result) => result.id!);

  return extracted;
};

// Command handling
const handleListCommand = () => listPlaylists();

const handleVideosCommand = (args: string[]) => {
  if (!args[0]) {
    throw new Error(
      "Usage: pnpm tsx src/youtube/examples.ts videos <PLAYLIST_ID>",
    );
  }
  return listPlaylistVideos(args[0]);
};

const handleAddCommand = (args: string[]) => {
  if (!args[0] || args.length < 2) {
    throw new Error(
      "Usage: pnpm tsx src/youtube/examples.ts add <PLAYLIST_ID> <VIDEO_ID_1> [VIDEO_ID_2] ...",
    );
  }
  return addVideosToPlaylist(args[0], args.slice(1));
};

const handleCreateCommand = (args: string[]) => {
  if (!args[0] || args.length < 2) {
    throw new Error(
      "Usage: pnpm tsx src/youtube/examples.ts create <TITLE> <VIDEO_ID_1> [VIDEO_ID_2] ...",
    );
  }
  return createPlaylistWithVideos(
    args[0],
    "Created via Signal Music Group",
    args.slice(1),
  );
};

const handleExtractCommand = (args: string[]) => {
  if (args.length === 0) {
    throw new Error(
      "Usage: pnpm tsx src/youtube/examples.ts extract <URL_1> [URL_2] ...",
    );
  }
  const ids = extractVideoIdsFromUrls(args);
  log("\nExtracted video IDs:");
  ids.forEach((id) => log(id));
};

const showHelp = () => {
  log("YouTube Playlist Manager - Examples");
  log("=====================================\n");
  log("Available commands:");
  log("  list                          - List all your playlists");
  log("  videos <PLAYLIST_ID>          - List videos in a playlist");
  log("  add <PLAYLIST_ID> <VIDEO_IDs> - Add videos to a playlist");
  log("  create <TITLE> <VIDEO_IDs>    - Create new playlist with videos");
  log("  extract <URLs>                - Extract video IDs from URLs");
  log("");
  log("Examples:");
  log("  pnpm tsx src/youtube/examples.ts list");
  log("  pnpm tsx src/youtube/examples.ts videos PLxxxxxx");
  log("  pnpm tsx src/youtube/examples.ts add PLxxxxxx dQw4w9WgXcQ");
  log('  pnpm tsx src/youtube/examples.ts create "My Playlist" dQw4w9WgXcQ');
  log(
    "  pnpm tsx src/youtube/examples.ts extract https://youtu.be/dQw4w9WgXcQ",
  );
};

const handleCommand = (command: string, args: string[]): Promise<any> => {
  const commands: Record<string, () => Promise<any>> = {
    list: handleListCommand,
    videos: () => handleVideosCommand(args),
    add: () => handleAddCommand(args),
    create: () => handleCreateCommand(args),
    extract: () => handleExtractCommand(args),
  };

  return commands[command] ? commands[command]!() : Promise.resolve(showHelp());
};

const handleError = (error: any) => {
  console.error("\n❌ Error:", error.message);
  if (error.code === "ENOENT" && error.path?.includes("token.json")) {
    log("\n💡 Please run authentication first:");
    log("   pnpm tsx src/youtube/auth.ts");
  }
  process.exit(1);
};

// Main execution
const main = async (): Promise<void> => {
  const command = process.argv[2] || "";
  const args = process.argv.slice(3);

  try {
    await handleCommand(command, args);
  } catch (error: any) {
    handleError(error);
  }
};

main();
