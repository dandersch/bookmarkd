# AI Agent Browser Testing

Playwright-based testing scaffold for AI agent exploration of the bookmarkd app.

## Setup

```bash
pip install playwright
playwright install chromium
```

## Workflow

### 1. Start the browser with extension

```bash
# Make sure the Go server is running first
cd /path/to/bookmarkd && go run main.go

# In another terminal, start the AI browser session
cd tests && python ai_browser.py
```

This launches Chromium with:
- The bookmarkd extension loaded from `./extension/`
- A persistent profile in `./test-profile/` (credentials persist)
- Helper functions for AI-friendly control

### 2. AI agent explores and tests

The AI uses these functions to interact:

| Function | Purpose | Token cost |
|----------|---------|------------|
| `get_accessibility_tree()` | Page structure | 500-2000 |
| `screenshot()` | Visual check | 1000-1500 |
| `goto(url)` | Navigate | - |
| `click(selector)` | Click element | - |
| `fill(selector, text)` | Fill input | - |
| `press(key)` | Keyboard | - |

**Prefer `get_accessibility_tree()` over raw HTML** - it's 10-50x smaller.

### 3. Generate test scripts

After exploring, ask the AI:
> "Turn what you just did into a Playwright Python test script"

The AI has conversation context of all actions taken and can generate a standalone test.

## Example Test

```python
from ai_browser import start_browser, goto_dashboard, click, fill, screenshot, close

def test_add_bookmark():
    start_browser()
    goto_dashboard()
    
    # Add a bookmark via the form
    fill("input[name='url']", "https://example.com")
    fill("input[name='title']", "Example Site")
    click("button[type='submit']")
    
    # Verify it appears
    screenshot("bookmark_added.png")
    close()

if __name__ == "__main__":
    test_add_bookmark()
```

## Extension Testing

The extension popup and options pages are accessible at:
- `chrome-extension://<id>/popup.html`
- `chrome-extension://<id>/options.html`

Use the helper functions:
```python
goto_extension_popup()
goto_extension_options()
```

## Notes

- `headless=False` is required for extensions (Chromium limitation)
- The browser runs in a separate window; use a different workspace while it runs
- Profile persists in `./test-profile/` - delete to reset extension config
