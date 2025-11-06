# Signal to YouTube Playlist

Automatically sync YouTube music links from your Signal group chats to a YouTube playlist.


## Prerequisites

- **Node.js**: v24.2.0 or higher
- **pnpm**: v9.0.0 or higher
- **Signal Desktop**: Installed with snap/...
- **YouTube API credentials**: See [YouTube Setup Guide](./YOUTUBE_SETUP.md)

## Installation

1. Clone the repository:
```bash
git clone git@github.com:select/signal-to-youtube-playlist.git
cd signal-to-youtube-playlist
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and configure:
```bash
# Signal Desktop path (relative to HOME)
SIGNAL_PATH=snap/signal-desktop/current/.config/Signal

# Signal group name (must match exactly)
SIGNAL_GROUP_NAME="My Music Group"

# YouTube Configuration
YOUTUBE_PLAYLIST_ID=PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
YOUTUBE_CREDENTIALS_PATH=./credentials.json
YOUTUBE_TOKEN_PATH=./token.json
```

4. Set up YouTube API credentials:

- Create a Google Cloud project
- Enable YouTube Data API v3
- Generate OAuth 2.0 credentials
- Authenticate your application
Follow the detailed guide in [YOUTUBE_SETUP.md](./YOUTUBE_SETUP.md) to:

5. Find your playlist ID:
```sh
npm youtube list
```
You can not copy the id to `YOUTUBE_PLAYLIST_ID` in `.env`.

## Usage

### Sync Signal Links to YouTube Playlist

Run the sync command to extract links from Signal and add new videos to your playlist:

```bash
pnpm sync
```

This will:
1. Load existing videos from your YouTube playlist
2. Extract YouTube links from Signal messages
3. Identify new videos not yet in the playlist
4. Add them sequentially with rate limiting
5. Display a summary of added, skipped, and failed videos

### Example Output

```
🎵 My Music Group - Playlist Updater
=========================================

1. 📋 Loading existing videos from YouTube playlist...
   Found 42 videos in playlist

2. 📱 Extracting YouTube links from Signal messages...
   Found 45 unique videos in Signal

3. 🔍 Checking for new videos...
   Found 3 new videos to add

4. ➕ Adding new videos to playlist...
[1/3] ✅ Added: Song Title - Artist Name
[2/3] ✅ Added: Another Song - Artist
[3/3] ⏭️  Already exists: abc123def45

✨ Update complete!

📊 Summary:
   Total Signal videos: 45
   Previously in playlist: 42
   New videos added: 2
   Skipped (not found/duplicate): 1
   Errors: 0
   Final playlist size: 44
```

## Development

### Available Scripts

```bash
# Run sync
pnpm sync

# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm lint:ts

# YouTube playlist tools: list, videos, add, create, extract
pnpm youtube
```

### Project Structure

```
signal-to-youtube-playlist/
├── src/
│   ├── signal/
│   │   └── extractor.ts       # Signal database extraction
│   ├── youtube/
│   │   ├── auth.ts            # YouTube authentication
│   │   ├── playlist.ts        # Playlist management
│   │   └── examples.ts        # Usage examples
│   └── update.ts              # Main sync script
├── .env.example               # Environment template
├── YOUTUBE_SETUP.md           # YouTube API setup guide
└── README.md
```

## How It Works

1. **Signal Extraction**: Connects to the encrypted Signal Desktop SQLite database using your local credentials
2. **Pattern Matching**: Extracts YouTube video IDs using regex patterns for `youtu.be` and `youtube.com/watch` URLs
3. **Deduplication**: Compares extracted videos against the current playlist to identify new additions
4. **API Integration**: Uses YouTube Data API v3 to add videos to the specified playlist
5. **Rate Limiting**: Adds 1-second delays between requests to stay within API quotas

## API Quotas

YouTube Data API has a daily limit of 10,000 units (free tier):
- Reading playlists: ~3 units per request
- Adding videos: ~50 units per video

Monitor your usage in the [Google Cloud Console](https://console.cloud.google.com/).

## Troubleshooting

### "Conversation not found" error
- Ensure `SIGNAL_GROUP_NAME` in `.env` matches the exact group name in Signal (including emojis)

### "Permission denied" error
- Verify your OAuth token has the correct YouTube scopes
- Check playlist permissions (must be editable by your account)

### "Token expired" error
- Delete `token.json` and re-run `pnpm tsx src/youtube/auth.ts`

### Signal database access issues
- Verify Signal Desktop is installed via snap
- Check that `SIGNAL_PATH` points to the correct location
- Ensure Signal is closed when running the sync

## Security Notes

- Never commit `credentials.json` or `token.json` to version control
- The Signal database key is read from Signal's local config (not stored in `.env`)
- YouTube API credentials should be kept secure

## License

MIT
