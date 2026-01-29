"""
AI Agent Browser Testing Scaffold for Bookmarkd

This module provides AI-friendly browser control for testing the bookmarkd
web dashboard and browser extension using Playwright.

## Workflow

1. Start the scaffold:
   ```bash
   cd tests && python ai_browser.py
   ```

2. AI agent explores and tests using the helper functions:
   - get_accessibility_tree() - understand page structure (500-2000 tokens)
   - screenshot() - visual checks (~1000-1500 tokens)
   - click(), fill(), goto() - perform actions

3. After testing, ask AI: "Turn what you just did into a Playwright Python test"
   - AI has conversation context of actions taken
   - Generated tests can run standalone without AI

## Extension Testing

The browser extension popup can be opened via its chrome-extension:// URL.
Use get_extension_popup_url() after browser launch to get the URL.
"""

import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext

# Configuration
EXTENSION_PATH = Path(__file__).parent.parent / "extension"
PROFILE_PATH = Path(__file__).parent.parent / "test-profile"
SERVER_HOST = os.getenv("BOOKMARKD_HOST", "localhost")
SERVER_PORT = os.getenv("BOOKMARKD_PORT", "8081")
DASHBOARD_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"

# HTTP Basic Auth (set these if your server requires auth)
HTTP_AUTH_USER = os.getenv("BOOKMARKD_AUTH_USER", "")
HTTP_AUTH_PASS = os.getenv("BOOKMARKD_AUTH_PASS", "")

# Global browser context and page
_playwright = None
_context: BrowserContext = None
_page: Page = None
_extension_id: str = None


def start_browser(headless: bool = False) -> tuple[BrowserContext, Page]:
    """
    Launch browser with extension loaded using persistent context.
    
    Args:
        headless: Must be False for extensions (Chromium requirement)
    
    Returns:
        Tuple of (context, page)
    """
    global _playwright, _context, _page, _extension_id
    
    # Ensure profile directory exists
    PROFILE_PATH.mkdir(exist_ok=True)
    
    _playwright = sync_playwright().start()
    
    # Launch with extension
    # Set up HTTP auth if configured
    http_credentials = None
    if HTTP_AUTH_USER and HTTP_AUTH_PASS:
        http_credentials = {"username": HTTP_AUTH_USER, "password": HTTP_AUTH_PASS}
    
    _context = _playwright.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_PATH),
        headless=False,  # Extensions require headed mode
        args=[
            f"--disable-extensions-except={EXTENSION_PATH.absolute()}",
            f"--load-extension={EXTENSION_PATH.absolute()}",
        ],
        viewport={"width": 1280, "height": 720},
        http_credentials=http_credentials,
    )
    
    # Get extension ID from service worker
    # Wait for extension to load
    _context.wait_for_event("serviceworker")
    workers = _context.service_workers
    for worker in workers:
        if "chrome-extension://" in worker.url:
            _extension_id = worker.url.split("/")[2]
            break
    
    _page = _context.new_page()
    print(f"Browser started. Extension ID: {_extension_id}")
    print(f"Dashboard URL: {DASHBOARD_URL}")
    print(f"Extension popup: chrome-extension://{_extension_id}/popup.html")
    
    return _context, _page


def get_page() -> Page:
    """Get the current page object."""
    return _page


def get_context() -> BrowserContext:
    """Get the browser context."""
    return _context


def get_extension_popup_url() -> str:
    """Get the extension popup URL."""
    if not _extension_id:
        raise RuntimeError("Browser not started. Call start_browser() first.")
    return f"chrome-extension://{_extension_id}/popup.html"


def get_extension_options_url() -> str:
    """Get the extension options page URL."""
    if not _extension_id:
        raise RuntimeError("Browser not started. Call start_browser() first.")
    return f"chrome-extension://{_extension_id}/options.html"


# =============================================================================
# AI-Friendly Helper Functions
# =============================================================================

def goto(url: str) -> None:
    """Navigate to a URL."""
    _page.goto(url)
    print(f"Navigated to: {url}")


def goto_dashboard() -> None:
    """Navigate to the bookmarkd dashboard."""
    goto(DASHBOARD_URL)


def goto_extension_popup() -> None:
    """Navigate to the extension popup page."""
    goto(get_extension_popup_url())


def goto_extension_options() -> None:
    """Navigate to the extension options page."""
    goto(get_extension_options_url())


def get_accessibility_tree() -> str:
    """
    Get the ARIA snapshot of the current page.
    
    This is the preferred method for AI to understand page structure.
    Returns ~500-2000 tokens vs 5000-50000+ for raw HTML.
    
    Returns:
        ARIA snapshot as a YAML-like string
    """
    snapshot = _page.locator("body").aria_snapshot()
    return snapshot


def print_accessibility_tree() -> None:
    """Print the accessibility tree in a readable format."""
    tree = get_accessibility_tree()
    print(tree)


def screenshot(path: str = None, full_page: bool = False) -> bytes:
    """
    Take a screenshot of the current page.
    
    Args:
        path: Optional path to save the screenshot
        full_page: Whether to capture the full scrollable page
    
    Returns:
        Screenshot as bytes
    """
    if path is None:
        path = str(Path(__file__).parent / "screenshot.png")
    
    screenshot_bytes = _page.screenshot(path=path, full_page=full_page)
    print(f"Screenshot saved to: {path}")
    return screenshot_bytes


def click(selector: str) -> None:
    """
    Click an element by CSS selector or text.
    
    Examples:
        click("button")
        click("text=Save")
        click("#submit-btn")
        click("[data-testid='login']")
    """
    _page.click(selector)
    print(f"Clicked: {selector}")


def fill(selector: str, text: str) -> None:
    """
    Fill a text input with the given text.
    
    Args:
        selector: CSS selector for the input
        text: Text to fill
    """
    _page.fill(selector, text)
    print(f"Filled '{selector}' with: {text}")


def type_text(selector: str, text: str, delay: int = 50) -> None:
    """
    Type text character by character (useful for inputs with handlers).
    
    Args:
        selector: CSS selector for the input
        text: Text to type
        delay: Delay between keystrokes in ms
    """
    _page.type(selector, text, delay=delay)
    print(f"Typed into '{selector}': {text}")


def press(key: str) -> None:
    """
    Press a keyboard key.
    
    Examples:
        press("Enter")
        press("Tab")
        press("Control+a")
    """
    _page.keyboard.press(key)
    print(f"Pressed: {key}")


def wait_for(selector: str, timeout: int = 5000) -> None:
    """Wait for an element to appear."""
    _page.wait_for_selector(selector, timeout=timeout)
    print(f"Found: {selector}")


def get_text(selector: str) -> str:
    """Get the text content of an element."""
    text = _page.text_content(selector)
    print(f"Text of '{selector}': {text}")
    return text


def get_html(selector: str = "body") -> str:
    """
    Get the HTML of an element. Use sparingly - prefer accessibility tree.
    """
    return _page.inner_html(selector)


def evaluate(js: str):
    """Execute JavaScript in the page context."""
    return _page.evaluate(js)


def close() -> None:
    """Close the browser."""
    global _playwright, _context, _page, _extension_id
    if _context:
        _context.close()
        _context = None
        _page = None
        _extension_id = None
    if _playwright:
        _playwright.stop()
        _playwright = None
    print("Browser closed.")


# =============================================================================
# Interactive Mode
# =============================================================================

def interactive():
    """
    Start an interactive session for AI agent testing.
    
    This keeps the browser open and provides a REPL-like experience.
    The AI agent can call helper functions and explore the app.
    """
    print("\n" + "=" * 60)
    print("AI Browser Testing Session Started")
    print("=" * 60)
    print(f"\nDashboard: {DASHBOARD_URL}")
    print(f"Extension popup: chrome-extension://{_extension_id}/popup.html")
    print(f"Extension options: chrome-extension://{_extension_id}/options.html")
    print("\nHelper functions available:")
    print("  goto(url), goto_dashboard(), goto_extension_popup()")
    print("  get_accessibility_tree(), print_accessibility_tree()")
    print("  screenshot(), click(sel), fill(sel, text), press(key)")
    print("  wait_for(sel), get_text(sel), close()")
    print("\nPress Ctrl+C to exit and close browser.")
    print("=" * 60 + "\n")
    
    try:
        # Keep session alive
        import code
        code.interact(local=globals())
    except KeyboardInterrupt:
        pass
    finally:
        close()


# =============================================================================
# Example Usage
# =============================================================================

def wait_for_load(timeout: int = 3000) -> None:
    """Wait for network to be idle (page fully loaded)."""
    _page.wait_for_load_state("networkidle", timeout=timeout)
    print("Page loaded.")


if __name__ == "__main__":
    # Start browser with extension
    start_browser()
    
    # Navigate to dashboard and wait for bookmarks to load
    goto_dashboard()
    wait_for_load()
    
    # Show accessibility tree (AI-friendly page understanding)
    print("\n--- Dashboard Accessibility Tree ---")
    print_accessibility_tree()
    screenshot()
    
    # Start interactive session - AI can navigate to popup with goto_extension_popup()
    interactive()
