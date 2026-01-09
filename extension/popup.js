const COMPACT_THRESHOLD = 100;

document.addEventListener('DOMContentLoaded', async () => {
    // State
    let currentValidTab = null;

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
    const saveBtn = document.getElementById('btn-save');
    const saveBtnText = saveBtn.querySelector('.btn-save-text');
    const status = document.getElementById('status-msg');
    const originalBtnText = saveBtnText.textContent;

    // Setup "Open Dashboard" link
    document.getElementById('open-web').addEventListener('click', () => {
        window.open(serverUrl, '_blank');
    });

    // 2. Initial Fetch of Bookmark List
    await fetchBookmarks(serverUrl, config.authHeader);

    // --- CORE LOGIC: Get current tab preview ---
    async function updatePreview() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (tab && tab.url && tab.url.startsWith('http')) {
                currentValidTab = tab;
                previewCard.classList.remove('hidden');
                saveBtn.disabled = false;
                previewTitle.textContent = tab.title || "No Title";
                previewUrl.textContent = new URL(tab.url).hostname;
                previewIcon.src = tab.favIconUrl || 'icon.png'; 
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
                saveBtn.disabled = true;
            }
        } catch (err) {
            console.error('Failed to get current tab:', err);
            currentValidTab = null;
            previewCard.classList.add('hidden');
            saveBtn.disabled = true;
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
                saveBtn.disabled = false;
                previewTitle.textContent = tab.title || "No Title";
                previewUrl.textContent = new URL(tab.url).hostname;
                previewIcon.src = tab.favIconUrl || 'icon.png';
            } else {
                currentValidTab = null;
                previewCard.classList.add('hidden');
                saveBtn.disabled = true;
            }
        }
    });

    // --- ACTION: Save Bookmark ---
    saveBtn.addEventListener('click', async () => {
        if (!currentValidTab) return;

        const editedTitle = previewTitle.innerText;

        saveBtn.disabled = true;
        saveBtnText.textContent = "Saving...";
        status.classList.add('hidden');

        try {
            const payload = {
                url: currentValidTab.url,
                title: editedTitle,
                category: "Uncategorized"
            };

            const headers = { "Content-Type": "application/json" };
            if (config.authHeader) headers["Authorization"] = config.authHeader;

            const res = await fetch(`${serverUrl}/api/bookmarks`, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error("Server error: " + res.status);

            // Success
            status.innerText = "Saved!";
            status.className = "alert alert-success text-center text-xs py-2 block";
            
            // Refresh list
            await fetchBookmarks(serverUrl, config.authHeader);

            setTimeout(() => {
                status.classList.add('hidden');
            }, 1500);

        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs py-2 block";
        } finally {
            saveBtnText.textContent = originalBtnText;
            saveBtn.disabled = false;
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

    // Enter to save
    previewTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveBtn.click();
        }
    });
});

// --- HELPERS ---

async function fetchBookmarks(baseUrl, authHeader) {
    const listEl = document.getElementById('bookmark-list');
    
    // Set config attributes for bookmark-item components to use
    listEl.setAttribute('server-url', baseUrl);
    if (authHeader) listEl.setAttribute('auth-header', authHeader);

    try {
        const headers = {};
        if (authHeader) headers["Authorization"] = authHeader;

        const res = await fetch(`${baseUrl}/api/bookmarks`, { headers });
        if (!res.ok) throw new Error("Failed to load");
        
        const bookmarks = await res.json();
        listEl.setBookmarks(bookmarks);
    } catch (err) {
        listEl.innerHTML = `<li class="p-4 text-center text-error text-xs">Cannot connect to server.<br>Check Options.</li>`;
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
