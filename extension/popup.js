const COMPACT_THRESHOLD = 100;

document.addEventListener('DOMContentLoaded', async () => {
    // Load theme
    chrome.storage.sync.get(['theme'], (items) => {
        const theme = items.theme || 'forest';
        document.documentElement.setAttribute('data-theme', theme);
    });

    // State
    let currentValidTab = null;
    let allBookmarks = [];
    let existingBookmark = null;

    // Compact mode detection (CSS-only, just toggle class)
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const width = entry.contentRect.width;
            if (width <= COMPACT_THRESHOLD) {
                document.body.classList.add('compact');
            } else {
                document.body.classList.remove('compact');
            }
        }
    });
    resizeObserver.observe(document.body);

    // 1. Load Settings
    const config = await getSettings();
    const serverUrl = config.serverUrl || "http://localhost:8080";
    
    // UI References
    const previewCard = document.getElementById('preview-card');
    const previewTitle = document.getElementById('preview-title');
    const previewUrl = document.getElementById('preview-url');
    const previewIcon = document.getElementById('preview-icon');
    const saveFavicon = document.getElementById('save-favicon');
    const actionOverlay = document.getElementById('action-overlay');
    const status = document.getElementById('status-msg');

    // Setup "Open Dashboard" link
    document.getElementById('open-web').addEventListener('click', () => {
        window.open(serverUrl, '_blank');
    });

    // Check if current tab URL is already bookmarked
    function checkIfBookmarked() {
        if (!currentValidTab || !currentValidTab.url) {
            existingBookmark = null;
            updatePreviewState();
            return;
        }

        existingBookmark = allBookmarks.find(bm => bm.url === currentValidTab.url) || null;
        updatePreviewState();
    }

    // Update preview card visual state based on bookmark status
    function updatePreviewState() {
        if (existingBookmark) {
            previewCard.classList.add('bookmarked');
            actionOverlay.textContent = '−';
            saveFavicon.title = 'Click to remove bookmark';
            previewTitle.textContent = existingBookmark.title || currentValidTab.title || 'No Title';
        } else {
            previewCard.classList.remove('bookmarked');
            actionOverlay.textContent = '+';
            saveFavicon.title = 'Click to bookmark';
            if (currentValidTab) {
                previewTitle.textContent = currentValidTab.title || 'No Title';
            }
        }
    }

    // 2. Initial Fetch of Bookmark List and Categories
    allBookmarks = await fetchData(serverUrl, config.authHeader);

    // Refresh bookmarks after drag-and-drop move
    document.getElementById('bookmark-list').addEventListener('bookmark-moved', async () => {
        allBookmarks = await fetchData(serverUrl, config.authHeader);
        checkIfBookmarked();
    });

    // Refresh after category changes
    document.getElementById('bookmark-list').addEventListener('category-changed', async () => {
        allBookmarks = await fetchData(serverUrl, config.authHeader);
        checkIfBookmarked();
    });

    // --- CORE LOGIC: Get current tab preview ---
    async function updatePreview() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && tab.url && tab.url.startsWith('http')) {
                currentValidTab = tab;
                previewCard.classList.remove('hidden');
                previewUrl.textContent = new URL(tab.url).hostname;
                previewIcon.src = tab.favIconUrl || 'icon.png';
                checkIfBookmarked();
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
            }
        } catch (err) {
            console.error('Failed to get current tab:', err);
            currentValidTab = null;
            previewCard.classList.add('hidden');
        }
    }

    // Initialize Preview on popup open
    await updatePreview();

    // Listen for tab updates from background worker
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'TAB_UPDATED' && message.tab) {
            const tab = message.tab;
            if (tab.url && tab.url.startsWith('http')) {
                currentValidTab = tab;
                previewCard.classList.remove('hidden');
                previewUrl.textContent = new URL(tab.url).hostname;
                previewIcon.src = tab.favIconUrl || 'icon.png';
                checkIfBookmarked();
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
            }
        }
    });

    // --- ACTION: Save or Delete Bookmark (via favicon click) ---
    saveFavicon.addEventListener('click', async () => {
        if (!currentValidTab) return;

        // Visual feedback - disable interaction during action
        saveFavicon.style.pointerEvents = 'none';
        saveFavicon.style.opacity = '0.5';
        status.classList.add('hidden');

        try {
            const headers = { "Content-Type": "application/json" };
            if (config.authHeader) headers["Authorization"] = config.authHeader;

            if (existingBookmark) {
                // DELETE existing bookmark
                const res = await fetch(`${serverUrl}/api/bookmarks/${existingBookmark.id}`, {
                    method: "DELETE",
                    headers
                });

                if (!res.ok) throw new Error("Server error: " + res.status);

                status.innerText = "Removed!";
                status.className = "alert alert-warning text-center text-xs py-2 block";
            } else {
                // POST new bookmark
                const editedTitle = previewTitle.innerText;
                const payload = {
                    url: currentValidTab.url,
                    title: editedTitle,
                    category: "Uncategorized",
                    favicon: currentValidTab.favIconUrl || ''
                };

                const res = await fetch(`${serverUrl}/api/bookmarks`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload)
                });

                if (!res.ok) throw new Error("Server error: " + res.status);

                status.innerText = "Saved!";
                status.className = "alert alert-success text-center text-xs py-2 block";
            }

            // Refresh list and re-check bookmark state
            allBookmarks = await fetchData(serverUrl, config.authHeader);
            checkIfBookmarked();

            setTimeout(() => {
                status.classList.add('hidden');
            }, 1500);

        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs py-2 block";
        } finally {
            saveFavicon.style.pointerEvents = '';
            saveFavicon.style.opacity = '';
        }
    });

    // Auto-select text on click for the editable title
    previewTitle.addEventListener('focus', (e) => {
        const range = document.createRange();
        range.selectNodeContents(e.target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    // Track original title to detect changes
    let originalTitle = '';
    previewTitle.addEventListener('focus', () => {
        originalTitle = previewTitle.innerText;
    });

    // Update bookmark title on blur (if bookmarked and changed)
    previewTitle.addEventListener('blur', async () => {
        const newTitle = previewTitle.innerText.trim();
        if (!existingBookmark || !newTitle || newTitle === originalTitle) return;

        try {
            const headers = { "Content-Type": "application/json" };
            if (config.authHeader) headers["Authorization"] = config.authHeader;

            const res = await fetch(`${serverUrl}/api/bookmarks/${existingBookmark.id}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ title: newTitle })
            });

            if (!res.ok) throw new Error("Server error: " + res.status);

            existingBookmark.title = newTitle;
            status.innerText = "Title updated!";
            status.className = "alert alert-success text-center text-xs py-2 block";
            setTimeout(() => status.classList.add('hidden'), 1500);

            // Refresh list to show updated title
            allBookmarks = await fetchData(serverUrl, config.authHeader);
        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs py-2 block";
        }
    });

    // Enter to save (for new) or update title (for existing)
    previewTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (existingBookmark) {
                previewTitle.blur();
            } else {
                saveFavicon.click();
            }
        }
    });
});

// --- HELPERS ---

async function fetchData(baseUrl, authHeader, storeCallback) {
    const listEl = document.getElementById('bookmark-list');
    
    // Set config attributes for bookmark-item components to use
    listEl.setAttribute('server-url', baseUrl);
    if (authHeader) listEl.setAttribute('auth-header', authHeader);

    try {
        const headers = {};
        if (authHeader) headers["Authorization"] = authHeader;

        const [bookmarksRes, categoriesRes] = await Promise.all([
            fetch(`${baseUrl}/api/bookmarks`, { headers }),
            fetch(`${baseUrl}/api/categories`, { headers })
        ]);

        if (!bookmarksRes.ok || !categoriesRes.ok) throw new Error("Failed to load");
        
        const bookmarks = await bookmarksRes.json();
        const categories = await categoriesRes.json();
        listEl.setData(bookmarks, categories);
        
        return bookmarks;
    } catch (err) {
        listEl.innerHTML = `<li class="p-4 text-center text-error text-xs">Cannot connect to server.<br>Check Options.</li>`;
        return [];
    }
}

function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['serverUrl', 'username', 'password'], (items) => {
            let authHeader = null;
            if (items.username && items.password) {
                const credentials = btoa(`${items.username}:${items.password}`);
                authHeader = `Basic ${credentials}`;
            }
            resolve({
                serverUrl: items.serverUrl,
                authHeader: authHeader
            });
        });
    });
}
