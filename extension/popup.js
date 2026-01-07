document.addEventListener('DOMContentLoaded', async () => {
    // State
    let currentValidTab = null;

    // 1. Load Settings
    const config = await getSettings();
    const serverUrl = config.serverUrl || "http://localhost:8080";
    
    // UI References
    const previewCard = document.getElementById('preview-card');
    const previewTitle = document.getElementById('preview-title');
    const previewUrl = document.getElementById('preview-url');
    const previewIcon = document.getElementById('preview-icon');
    const saveBtn = document.getElementById('btn-save');
    const status = document.getElementById('status-msg');

    // Setup "Open Dashboard" link
    document.getElementById('open-web').addEventListener('click', () => {
        window.open(serverUrl, '_blank');
    });

    // 2. Initial Fetch of Bookmark List
    await fetchBookmarks(serverUrl, config.authHeader);


    // --- CORE LOGIC: Reactive Tab Preview ---

    async function updatePreview() {
        // Query the active tab in the last focused "normal" window
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

        // Logic: Is this a valid page to bookmark?
        if (tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
            currentValidTab = tab;
            
            // Show Preview
            previewCard.classList.remove('hidden');
            saveBtn.disabled = false;
            saveBtn.classList.remove('btn-disabled');

            // Populate Data
            previewTitle.textContent = tab.title || "No Title";
            previewUrl.textContent = new URL(tab.url).hostname; // Show just domain to keep it clean
            
            // Favicon Fallback
            previewIcon.src = tab.favIconUrl || 'icon.png'; 
            
        } else {
            // Invalid Page (New Tab, Settings, Local file, etc.)
            currentValidTab = null;
            previewCard.classList.add('hidden');
            
            // Disable Save Button
            saveBtn.disabled = true;
            saveBtn.classList.add('btn-disabled');
        }
    }

    // Initialize Preview immediately
    updatePreview();

    // Listen for Tab Switches
    chrome.tabs.onActivated.addListener(() => {
        updatePreview();
    });

    // Listen for Navigation in the current tab (e.g. clicking a link)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (tab.active && changeInfo.status === 'complete') {
            updatePreview();
        }
    });


    // --- ACTION: Save Bookmark ---

    saveBtn.addEventListener('click', async () => {
        if (!currentValidTab) return;

        // UI Feedback: Loading
        saveBtn.disabled = true;
        const originalText = saveBtn.innerText;
        saveBtn.innerText = "Saving...";

        try {
            const payload = {
                url: currentValidTab.url,
                title: currentValidTab.title,
                category: "Uncategorized" // We can make this dynamic later
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
            status.className = "alert alert-success text-center text-xs mt-2 block p-2 rounded";
            
            // Refresh list
            await fetchBookmarks(serverUrl, config.authHeader);

        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs mt-2 block p-2 rounded";
        } finally {
            saveBtn.innerText = originalText;
            // Note: We don't re-enable immediately if the preview is still valid, 
            // but usually we want to allow saving again or just wait.
            // Let's re-enable after a short delay or keep disabled if you want "Save Once"
            setTimeout(() => {
                saveBtn.disabled = false;
                status.classList.add('hidden');
            }, 1500);
        }
    });
});

// --- HELPERS ---

async function fetchBookmarks(baseUrl, authHeader) {
    const listEl = document.getElementById('bookmark-list');
    try {
        const headers = {};
        if (authHeader) headers["Authorization"] = authHeader;

        const res = await fetch(`${baseUrl}/api/bookmarks`, { headers });
        if (!res.ok) throw new Error("Failed to load");
        
        const html = await res.text();
        listEl.innerHTML = html;
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
