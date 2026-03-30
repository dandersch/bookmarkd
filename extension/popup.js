const COMPACT_THRESHOLD = 100;

document.addEventListener('DOMContentLoaded', async () => {
    // Load theme and custom themes
    chrome.storage.sync.get(['theme', 'customThemes'], (items) => {
        // Inject custom theme CSS
        const customThemes = items.customThemes || {};
        if (Object.keys(customThemes).length > 0) {
            const styleEl = document.createElement('style');
            styleEl.id = 'custom-themes-style';
            styleEl.textContent = Object.values(customThemes).join('\n');
            document.head.appendChild(styleEl);
        }

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

    // Notes UI elements
    const notesSection = document.getElementById('notes-section');
    const notesToggle = document.getElementById('notes-toggle');
    const notesArrow = document.getElementById('notes-arrow');
    const notesContainer = document.getElementById('notes-container');
    const notesTextarea = document.getElementById('notes-textarea');
    const notesCount = document.getElementById('notes-count');
    let notesExpanded = false;
    let originalNotes = '';

    // Update preview card visual state based on bookmark status
    function updatePreviewState() {
        if (existingBookmark) {
            previewCard.classList.add('bookmarked');
            actionOverlay.textContent = '−';
            saveFavicon.title = 'Click to remove bookmark';
            previewTitle.textContent = existingBookmark.title || currentValidTab.title || 'No Title';
            notesSection.classList.remove('hidden');
            notesTextarea.value = existingBookmark.notes || '';
            originalNotes = existingBookmark.notes || '';
            notesCount.textContent = notesTextarea.value.length;
        } else {
            previewCard.classList.remove('bookmarked');
            actionOverlay.textContent = '+';
            saveFavicon.title = 'Click to bookmark';
            if (currentValidTab) {
                previewTitle.textContent = currentValidTab.title || 'No Title';
            }
            notesSection.classList.add('hidden');
            notesContainer.classList.add('hidden');
            notesExpanded = false;
            notesArrow.textContent = '▶';
        }
    }

    // Notes toggle
    notesToggle.addEventListener('click', () => {
        notesExpanded = !notesExpanded;
        notesContainer.classList.toggle('hidden', !notesExpanded);
        notesArrow.textContent = notesExpanded ? '▼' : '▶';
        if (notesExpanded) {
            notesTextarea.focus();
        }
    });

    // Notes character counter
    notesTextarea.addEventListener('input', () => {
        notesCount.textContent = notesTextarea.value.length;
    });

    // Notes auto-save on blur
    notesTextarea.addEventListener('blur', async () => {
        const newNotes = notesTextarea.value;
        if (!existingBookmark || newNotes === originalNotes) return;

        try {
            const headers = { "Content-Type": "application/json" };
            if (config.authHeader) headers["Authorization"] = config.authHeader;

            const res = await fetch(`${serverUrl}/api/bookmarks/${existingBookmark.id}`, {
                method: "PATCH",
                headers,
                body: JSON.stringify({ notes: newNotes })
            });

            if (!res.ok) throw new Error("Server error: " + res.status);

            existingBookmark.notes = newNotes;
            originalNotes = newNotes;
            status.innerText = "Notes saved!";
            status.className = "alert alert-success text-center text-xs py-2 block";
            setTimeout(() => status.classList.add('hidden'), 1500);

            allBookmarks = await fetchData(serverUrl, config.authHeader);
        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs py-2 block";
        }
    });

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

    // Time tracking section
    const timeTrackingSection = document.getElementById('time-tracking-section');
    const timeTrackingValue = document.getElementById('time-tracking-value');
    const timeTrackingRemaining = document.getElementById('time-tracking-remaining');
    let timeTrackingInterval = null;
    let trackedTodaySeconds = 0;
    let trackedLimitMinutes = 0;
    let trackedLastFetch = 0;

    function formatHHMM(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        return `${h}:${String(m).padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        // Estimate current seconds: fetched total + time elapsed since fetch
        const elapsed = Math.floor((Date.now() - trackedLastFetch) / 1000);
        const currentSeconds = trackedTodaySeconds + elapsed;

        timeTrackingValue.textContent = formatHHMM(currentSeconds);

        if (trackedLimitMinutes > 0) {
            const limitSeconds = trackedLimitMinutes * 60;
            const remaining = limitSeconds - currentSeconds;
            timeTrackingRemaining.classList.remove('hidden');

            if (remaining > 0) {
                timeTrackingRemaining.textContent = `-${formatHHMM(remaining)}`;
                timeTrackingRemaining.style.color = '';
            } else {
                const over = Math.abs(remaining);
                timeTrackingRemaining.textContent = `+${formatHHMM(over)}`;
                timeTrackingRemaining.style.color = 'oklch(var(--er))';
            }
        } else {
            timeTrackingRemaining.classList.add('hidden');
        }
    }

    function startTimeTrackingTimer() {
        if (timeTrackingInterval) clearInterval(timeTrackingInterval);
        updateTimeDisplay();
        timeTrackingInterval = setInterval(updateTimeDisplay, 1000);
    }

    function stopTimeTrackingTimer() {
        if (timeTrackingInterval) {
            clearInterval(timeTrackingInterval);
            timeTrackingInterval = null;
        }
    }

    async function updateTimeTrackingSection(url) {
        try {
            const domain = new URL(url).hostname.replace(/^www\./, '');
            const response = await chrome.runtime.sendMessage({ type: 'IS_DOMAIN_TRACKED', domain });
            if (!response?.tracked) {
                timeTrackingSection.classList.add('hidden');
                stopTimeTrackingTimer();
                return;
            }

            const headers = {};
            if (config.authHeader) headers['Authorization'] = config.authHeader;
            const res = await fetch(`${serverUrl}/api/time-tracking/${domain}`, { headers });
            if (!res.ok) { timeTrackingSection.classList.add('hidden'); stopTimeTrackingTimer(); return; }

            const data = await res.json();
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
            trackedTodaySeconds = (data.entries || [])
                .filter(e => e.timestamp >= startOfDay)
                .reduce((sum, e) => sum + e.seconds, 0);
            trackedLastFetch = Date.now();

            // Find daily time limit from already-loaded bookmarks
            trackedLimitMinutes = 0;
            for (const bm of allBookmarks) {
                if (bm.daily_time_limit && bm.daily_time_limit > 0) {
                    try {
                        const bmDomain = new URL(bm.url).hostname.replace(/^www\./, '');
                        if (bmDomain === domain) {
                            trackedLimitMinutes = bm.daily_time_limit;
                            break;
                        }
                    } catch {}
                }
            }

            timeTrackingSection.classList.remove('hidden');
            startTimeTrackingTimer();
        } catch {
            timeTrackingSection.classList.add('hidden');
            stopTimeTrackingTimer();
        }
    }

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
                updateTimeTrackingSection(tab.url);
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
                timeTrackingSection.classList.add('hidden');
            }
        } catch (err) {
            console.error('Failed to get current tab:', err);
            currentValidTab = null;
            previewCard.classList.add('hidden');
            timeTrackingSection.classList.add('hidden');
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
                updateTimeTrackingSection(tab.url);
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
                timeTrackingSection.classList.add('hidden');
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
