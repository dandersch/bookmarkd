document.addEventListener('DOMContentLoaded', () => {
    // Restore
    chrome.storage.sync.get(['serverUrl', 'username', 'password'], (items) => {
        document.getElementById('serverUrl').value = items.serverUrl || 'http://localhost:8080';
        document.getElementById('username').value = items.username || '';
        document.getElementById('password').value = items.password || '';
    });

    // Save
    document.getElementById('save').addEventListener('click', () => {
        const serverUrl = document.getElementById('serverUrl').value.replace(/\/$/, ""); // remove trailing slash
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        chrome.storage.sync.set({ serverUrl, username, password }, () => {
            const status = document.getElementById('status');
            status.textContent = 'Options saved.';
            setTimeout(() => status.textContent = '', 2000);
        });
    });
});
