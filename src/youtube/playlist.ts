import { google, youtube_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFile, writeFile } from "node:fs/promises";
import { config } from "dotenv";

// Load environment variables
config();

const CREDENTIALS_PATH =
  process.env.YOUTUBE_CREDENTIALS_PATH || "./credentials.json";
const TOKEN_PATH = process.env.YOUTUBE_TOKEN_PATH || "./token.json";
const SCOPES = ["https://www.googleapis.com/auth/youtube"];

export interface YouTubeClient {
  youtube: youtube_v3.Youtube;
  oauth2Client: OAuth2Client;
}

interface Credentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

// Credentials management
const parseCredentialsFile = (content: any): Credentials => {
  if (content.installed) {
    return {
      client_id: content.installed.client_id,
      client_secret: content.installed.client_secret,
      redirect_uri: content.installed.redirect_uris[0],
    };
  } else if (content.web) {
    return {
      client_id: content.web.client_id,
      client_secret: content.web.client_secret,
      redirect_uri: content.web.redirect_uris[0],
    };
  }
  return content;
};

const loadCredentials = async (): Promise<Credentials> => {
  const content = await readFile(CREDENTIALS_PATH, "utf-8");
  return parseCredentialsFile(JSON.parse(content));
};

const loadToken = async (): Promise<any> => {
  const content = await readFile(TOKEN_PATH, "utf-8");
  return JSON.parse(content);
};

const saveToken = async (tokens: any): Promise<void> => {
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
};

// OAuth2 client creation
const createOAuth2Client = (credentials: Credentials): OAuth2Client =>
  new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uri,
  );

const setCredentials = (
  oauth2Client: OAuth2Client,
  tokens: any,
): OAuth2Client => {
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
};

// YouTube client initialization
export const initializeYouTubeClient = async (): Promise<YouTubeClient> => {
  const credentials = await loadCredentials();
  const oauth2Client = createOAuth2Client(credentials);

  try {
    const token = await loadToken();
    setCredentials(oauth2Client, token);
  } catch (error) {
    throw new Error(
      "Authentication required. Please run authenticate() first.",
    );
  }

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  return { youtube, oauth2Client };
};

// Authentication
export const generateAuthUrl = async (): Promise<string> => {
  const credentials = await loadCredentials();
  const oauth2Client = createOAuth2Client(credentials);

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
};

export const exchangeCodeForToken = async (code: string): Promise<void> => {
  const credentials = await loadCredentials();
  const oauth2Client = createOAuth2Client(credentials);
  const { tokens } = await oauth2Client.getToken(code);
  await saveToken(tokens);
};

// Playlist operations
export const getPlaylists = async (
  client: YouTubeClient,
): Promise<youtube_v3.Schema$Playlist[]> => {
  const response = await client.youtube.playlists.list({
    part: ["snippet", "contentDetails"],
    mine: true,
    maxResults: 50,
  });
  return response.data.items || [];
};

const fetchPlaylistPage = async (
  client: YouTubeClient,
  playlistId: string,
  pageToken?: string,
): Promise<{
  items: youtube_v3.Schema$PlaylistItem[];
  nextPageToken?: string | null;
}> => {
  const response = await client.youtube.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId,
    maxResults: 50,
    pageToken,
  });
  return {
    items: response.data.items || [],
    nextPageToken: response.data.nextPageToken,
  };
};

const fetchAllPages = async (
  client: YouTubeClient,
  playlistId: string,
  pageToken?: string,
  accumulated: youtube_v3.Schema$PlaylistItem[] = [],
): Promise<youtube_v3.Schema$PlaylistItem[]> => {
  const { items, nextPageToken } = await fetchPlaylistPage(
    client,
    playlistId,
    pageToken,
  );
  const allItems = [...accumulated, ...items];

  return nextPageToken
    ? fetchAllPages(client, playlistId, nextPageToken, allItems)
    : allItems;
};

export const getPlaylistVideos = async (
  client: YouTubeClient,
  playlistId: string,
): Promise<youtube_v3.Schema$PlaylistItem[]> =>
  fetchAllPages(client, playlistId);

export const addVideoToPlaylist = async (
  client: YouTubeClient,
  playlistId: string,
  videoId: string,
): Promise<youtube_v3.Schema$PlaylistItem> => {
  const response = await client.youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId,
        },
      },
    },
  });
  return response.data;
};

export const removeVideoFromPlaylist = async (
  client: YouTubeClient,
  playlistItemId: string,
): Promise<void> => {
  await client.youtube.playlistItems.delete({
    id: playlistItemId,
  });
};

export const createPlaylist = async (
  client: YouTubeClient,
  title: string,
  description: string = "",
  privacyStatus: "private" | "public" | "unlisted" = "private",
): Promise<youtube_v3.Schema$Playlist> => {
  const response = await client.youtube.playlists.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus,
      },
    },
  });
  return response.data;
};

export const getVideoInfo = async (
  client: YouTubeClient,
  videoId: string,
): Promise<youtube_v3.Schema$Video | null> => {
  const response = await client.youtube.videos.list({
    part: ["snippet", "contentDetails", "statistics"],
    id: [videoId],
  });
  return response.data.items?.[0] || null;
};

// URL parsing
const videoIdPatterns = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
];

const tryExtractWithPattern = (url: string, pattern: RegExp): string | null => {
  const match = url.match(pattern);
  return match ? match[1] : null;
};

const isVideoId = (url: string): boolean => /^[a-zA-Z0-9_-]{11}$/.test(url);

export const extractVideoId = (url: string): string | null =>
  videoIdPatterns.reduce<string | null>(
    (result, pattern) => result || tryExtractWithPattern(url, pattern),
    null,
  ) || (isVideoId(url) ? url : null);

// Helper functions
export const getPlaylistVideoIds = async (
  client: YouTubeClient,
  playlistId: string,
): Promise<Set<string>> => {
  const videos = await getPlaylistVideos(client, playlistId);
  const videoIds = videos
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => !!id);
  return new Set(videoIds);
};
