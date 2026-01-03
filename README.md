# bookmarkd

Minimalist self-hosted bookmarking system with browser extension.

## Tech Stack
- **Backend:** Go (Standard Library + google/uuid).
- **Frontend:** HTML + TailwindCSS (Server-rendered).
- **Extension:** Manifest V3 (JS/HTML/CSS).
- **Storage:** Flat JSON (`bookmarks.json`), in-memory cache with overwrite on change.
- **Proxy/Auth:** Designed for use behind Reverse Proxy with HTTP Basic Auth

## Architecture
- **Server:**
    - `GET /`: Dashboard Webpage UI.
    - `GET /api/bookmarks`: Returns server-rendered HTML fragments for extension popup.
    - `POST /api/bookmarks`: Accepts JSON `{url, title, category}`.
- **Extension:**
    - `popup.html`: Displays recent bookmarks and "Save" button.
    - `options.html`: Configures server URL and optional auth credentials.
    - `popup.js`: Injects HTML fragments via `fetch()`; handles auth headers via `chrome.storage`.

## Data Schema (JSON)
```json
[{
  "id": "uuid",
  "url": "string",
  "title": "string",
  "category": "string",
  "timestamp": "int64",
  "favicon": "google-favicon-service-url"
}]
```
