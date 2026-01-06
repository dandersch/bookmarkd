// popup.js

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Settings
    const config = await getSettings();
    const serverUrl = config.serverUrl || "http://localhost:8080";
    
    // Setup "Open Dashboard" link
    document.getElementById('open-web').addEventListener('click', () => {
        window.open(serverUrl, '_blank');
    });

    // 2. Initial Fetch of Bookmarks
    await fetchBookmarks(serverUrl, config.authHeader);

    // 3. Handle Save Button
    document.getElementById('btn-save').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save');
        const status = document.getElementById('status-msg');
        
        // Get current tab info
        // TODO doesnt work with sidepanel after switching tabs
        // see https://stackoverflow.com/questions/77276350/chrome-extension-how-to-show-the-active-tab-url-with-updates-when-it-changes
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log(tab);
        
        if (!tab) return;

        // UI Feedback: Loading
        btn.disabled = true;
        btn.innerText = "Saving...";

        try {
            const payload = {
                url: tab.url,
                title: tab.title,
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
            status.className = "alert alert-success text-center text-xs mt-2 block";
            
            // Refresh list
            await fetchBookmarks(serverUrl, config.authHeader);

        } catch (err) {
            status.innerText = "Error: " + err.message;
            status.className = "alert alert-error text-center text-xs mt-2 block";
        } finally {
            btn.disabled = false;
            btn.innerText = "Bookmark This Page";
            // Hide status after 2 seconds
            setTimeout(() => status.classList.add('hidden'), 2000);
        }
    });
});

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
        listEl.innerHTML = `<li class="p-4 text-center text-red-500 text-xs">Cannot connect to server.<br>Check Options or Server status.</li>`;
    }
}

function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['serverUrl', 'username', 'password'], (items) => {
            let authHeader = null;
            if (items.username && items.password) {
                // Create Basic Auth Base64
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
