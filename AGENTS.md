# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bookmarkd is a minimalist self-hosted bookmarking system with multiple clients (browser extension and bookmarklet). The architecture uses a single Go binary with flat JSON file storage, designed to run behind a reverse proxy with HTTP Basic Auth.

## Commands

### Development
```bash
# Run the server (requires .env file with BOOKMARKD_HOST and BOOKMARKD_PORT)
go run main.go

# Install dependencies
go mod download

# Build binary
go build -o bookmarkd main.go
```

### Extension Development
The browser extension is located in `extension/` and uses Manifest V3. To test:
- Chrome: Load unpacked extension from `extension/` directory
- Firefox: Load temporary add-on from `extension/manifest.json`

## Architecture

### Backend (main.go)
Single-file Go server with three key components:

1. **Data Layer**: In-memory slice `bookmarks []Bookmark` backed by `bookmarks.json`
   - All reads/writes use `sync.RWMutex` for concurrency safety
   - Write operations immediately persist to disk via `saveBookmarks()`
   - Data structure: UUID, URL, Title, Category, Timestamp, Favicon URL

2. **HTTP Routes**:
   - `GET /`: Server-rendered HTML dashboard (uses `index.html` template)
   - `GET /api/bookmarks`: Returns HTML fragments for extension popup
   - `POST /api/bookmarks`: Accepts JSON `{url, title, category}`
   - All `/api/*` routes include CORS headers for extension access

3. **Configuration**: Uses `.env` file (see `env.template`) for host/port settings
   - Loaded via `github.com/joho/godotenv`
   - Required: `BOOKMARKD_HOST` and `BOOKMARKD_PORT`

### Frontend Clients

**Extension (`extension/`)**:
- `popup.js`: Fetches HTML fragments from server, stores auth in `chrome.storage.sync`
- `options.js`: Configures server URL and Basic Auth credentials
- Auth handled via `Authorization: Basic` header when credentials provided
- Uses TailwindCSS via CDN for styling

**Bookmarklet (`bookmarklet.js`)**:
- Standalone JavaScript for bookmark bar
- Requires manual configuration of `SERVER_URL`, `AUTH_USER`, `AUTH_PASS`
- Creates temporary UI overlay for save confirmation

### Key Design Patterns

**Server-Rendered Fragments**: Extension popup receives pre-rendered HTML from `GET /api/bookmarks` rather than JSON, reducing client-side templating. The fragment template is defined inline at main.go:150-159.

**Auth Strategy**: No auth in the Go server itself. Designed to sit behind reverse proxy (Nginx/Caddy) with HTTP Basic Auth. Extension and bookmarklet pass `Authorization` header through.

**Favicon Handling**: Uses Google's favicon service (`https://www.google.com/s2/favicons?domain=...&sz=64`) rather than fetching directly. Domain extracted in `createBookmark()` at main.go:116-121.

**Concurrency Model**: Read-heavy workload with prepend-on-write pattern (newest bookmarks first). Write lock held during entire save operation to prevent race conditions.

## File Layout
```
main.go              - Single-file Go server
index.html           - Dashboard template
bookmarks.json       - Persistent storage (git-ignored)
extension/           - Browser extension (Manifest V3)
  ├── popup.html/js  - Extension UI
  ├── options.html/js - Settings page
  └── manifest.json   - Extension config
bookmarklet.js       - Bookmark bar alternative
.env                 - Server config (git-ignored)
```

## Important Notes

- The `bookmarks` slice is kept in memory and saved on every write. For large datasets (>10k bookmarks), consider batch writes or alternative persistence.
- Extension expects HTML fragments, not JSON. If modifying `renderBookmarksFragment()`, ensure output remains valid HTML list items.
- Port configuration has inconsistent format in `env.template` (includes `:` prefix on port) vs actual usage. The correct format is just the port number without `:`.
