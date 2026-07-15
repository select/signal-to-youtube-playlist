/**
 * Cache the frozen legacy playlist's video ids to data/legacy-playlist-ids.json.
 *
 * The legacy playlist ("Musik Gruppe 2025", id PLHh-DPsAXiAUVUVA9DpRtiYRrwgvqg8Fx)
 * is full at YouTube's 5000-item cap and will not change anymore. New videos are
 * instead added to the current playlist (YOUTUBE_PLAYLIST_ID). To avoid re-adding
 * the already-archived videos, `update.ts` unions the current playlist's live ids
 * with this cached legacy id set.
 *
 * Run once after setting up the new playlist (and re-run only if the legacy
 * playlist ever changes, which it shouldn't):
 *
 *   pnpm cache:legacy
 *
 * The cache is built for free from music-player-deluxe's already-fetched
 * playlist file (no YouTube API quota cost). Falls back to a live API fetch of
 * the legacy playlist if that file is unavailable.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import {
	initializeYouTubeClient,
	getPlaylistVideoIds,
} from "../src/youtube/playlist.js";

config();

const LEGACY_PLAYLIST_ID =
  process.env.LEGACY_PLAYLIST_ID || "PLHh-DPsAXiAUVUVA9DpRtiYRrwgvqg8Fx";
const MUSIC_PLAYER_DELUXE_PATH =
  process.env.MUSIC_PLAYER_DELUXE_PATH || "../music-player-deluxe";
const CACHE_PATH = join(process.cwd(), "data", "legacy-playlist-ids.json");

const main = async (): Promise<void> => {
  console.log(`🎵 Caching legacy playlist ids for ${LEGACY_PLAYLIST_ID}`);

  let videoIds: string[] = [];

  // Preferred: read the already-fetched playlist JSON from music-player-deluxe
  // (free, no API quota). The file is the canonical served playlist which, at
  // the time of first caching, is just the legacy playlist (current playlist is
  // empty/new). We dedupe to be safe.
  const deluxePlaylistPath = join(
    MUSIC_PLAYER_DELUXE_PATH,
    "public",
    "playlist",
    `${LEGACY_PLAYLIST_ID}.json`,
  );
  try {
    const content = await readFile(deluxePlaylistPath, "utf-8");
    const data: { videos?: { id: string }[] } = JSON.parse(content);
    const ids = (data.videos || []).map((v) => v.id).filter(Boolean);
    videoIds = [...new Set(ids)];
    console.log(
      `   Read ${videoIds.length} ids from ${deluxePlaylistPath} (free, no quota)`,
    );
  } catch (error) {
    console.warn(
      `   Could not read ${deluxePlaylistPath} (${(error as Error).message}); falling back to a live API fetch of the legacy playlist (costs ~100 quota units, one-time)`,
    );
    const client = await initializeYouTubeClient();
    const idSet = await getPlaylistVideoIds(client, LEGACY_PLAYLIST_ID);
    videoIds = [...idSet];
    console.log(`   Fetched ${videoIds.length} ids from YouTube Data API`);
  }

  const cache = {
    playlistId: LEGACY_PLAYLIST_ID,
    videoIds,
    generatedAt: new Date().toISOString(),
    source: `music-player-deluxe:${deluxePlaylistPath}`,
    count: videoIds.length,
  };

  await mkdir(join(process.cwd(), "data"), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`\n✓ Wrote ${videoIds.length} legacy ids to ${CACHE_PATH}`);
};

main().catch((error) => {
  console.error("❌ Failed to cache legacy playlist ids:", error);
  process.exit(1);
});
