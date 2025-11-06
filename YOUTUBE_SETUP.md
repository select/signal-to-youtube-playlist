# YouTube API Setup Guide

This guide will help you set up the YouTube Data API v3 for managing playlists.

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **YouTube Data API v3**:
   - Go to "APIs & Services" > "Library"
   - Search for "YouTube Data API v3"
   - Click "Enable"

## Step 2: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure the OAuth consent screen if prompted:
   - Choose "External" for user type
   - Fill in the required fields (app name, user support email, etc.)
   - Add scopes: `https://www.googleapis.com/auth/youtube`
   - Add test users (your email)
4. Create OAuth client ID:
   - Application type: **Desktop app** (or **Web application** if deploying)
   - Name: `Signal Music Group`
   - Click "Create"
5. Download the credentials JSON file

## Step 3: Set Up Credentials

1. Save the downloaded credentials file as `credentials.json` in your project root
2. Add to your `.env` file:

```bash
YOUTUBE_CREDENTIALS_PATH=./credentials.json
YOUTUBE_TOKEN_PATH=./token.json
```

3. Add both files to `.gitignore` (already done):
```
credentials.json
token.json
```

## Step 4: First-Time Authentication

Run the authentication script to get your OAuth token:

```bash
pnpm tsx src/youtube/auth.ts
```

This will:
1. Display an authorization URL
2. Open your browser to grant permissions
3. Save the token for future use

## Step 5: Using the API

After authentication, you can use the YouTube Playlist Manager:

```typescript
import { YouTubePlaylistManager } from './youtube/playlist';

const manager = new YouTubePlaylistManager();
await manager.initialize();

// Get all playlists
const playlists = await manager.getPlaylists();

// Add video to playlist
await manager.addVideoToPlaylist('PLAYLIST_ID', 'VIDEO_ID');
```

## API Quotas

YouTube Data API has daily quota limits:
- **10,000 units per day** (free tier)
- Reading costs: 1-3 units per request
- Writing costs: 50-400 units per request

**Tip:** Monitor your usage in the Google Cloud Console under "APIs & Services" > "Dashboard"

## Troubleshooting

### "Access denied" error
- Make sure you added your email as a test user in the OAuth consent screen
- Check that the YouTube Data API v3 is enabled

### "Quota exceeded" error
- You've hit the daily API limit
- Wait until the next day (resets at midnight Pacific Time)
- Or request a quota increase in the Cloud Console

### "Token expired" error
- The token automatically refreshes if you set `access_type: 'offline'`
- If issues persist, delete `token.json` and re-authenticate

## Security Notes

- **Never commit** `credentials.json` or `token.json` to version control
- Keep your client secret secure
- Use environment variables for production deployments
- Consider using service accounts for server-to-server authentication
