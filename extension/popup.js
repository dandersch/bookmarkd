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

    let lastTabUrl = ""; // Track to prevent overwriting user edits on small updates

    async function updatePreview() {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

        if (tab && tab.url && (tab.url.startsWith('http'))) {
            currentValidTab = tab;
            previewCard.classList.remove('hidden');
            saveBtn.disabled = false;

            // ONLY update the text if the URL actually changed
            // This prevents the title from resetting if the page is still loading
            if (tab.url !== lastTabUrl) {
                previewTitle.textContent = tab.title || "No Title";
                lastTabUrl = tab.url;
            }

            previewUrl.textContent = new URL(tab.url).hostname;
            previewIcon.src = tab.favIconUrl || 'icon.png'; 
        } else {
            currentValidTab = null;
            lastTabUrl = "";
            previewCard.classList.add('hidden');
            saveBtn.disabled = true;
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

        // Grab the potentially edited title
        const editedTitle = document.getElementById('preview-title').innerText;

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";

        try {
           const payload = {
           url: currentValidTab.url,
           title: editedTitle, // Use the edited version!
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

    // Auto-select text on click for the editable title
    document.getElementById('preview-title').addEventListener('focus', (e) => {
        const range = document.createRange();
        range.selectNodeContents(e.target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    // Prevent "Enter" key from adding new lines (optional, keeps it a single line)
    document.getElementById('preview-title').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-save').click(); // Enter to Save!
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
