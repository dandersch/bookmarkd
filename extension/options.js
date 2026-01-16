document.addEventListener('DOMContentLoaded', () => {
    const importSection = document.getElementById('import-section');
    const themeSelect = document.getElementById('theme-select');

    // Restore and configure
    chrome.storage.sync.get(['serverUrl', 'username', 'password', 'theme'], (items) => {
        // Theme
        const theme = items.theme || 'forest';
        document.documentElement.setAttribute('data-theme', theme);
        themeSelect.value = theme;
        const serverUrl = items.serverUrl || 'http://localhost:8080';
        document.getElementById('serverUrl').value = serverUrl;
        document.getElementById('username').value = items.username || '';
        document.getElementById('password').value = items.password || '';

        // Configure import component
        importSection.setAttribute('server-url', serverUrl);
        if (items.username && items.password) {
            const credentials = btoa(`${items.username}:${items.password}`);
            importSection.setAttribute('auth-header', `Basic ${credentials}`);
        }
    });

    // Theme change (instant, no save button needed)
    themeSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        document.documentElement.setAttribute('data-theme', theme);
        chrome.storage.sync.set({ theme });
    });

    // Save
    document.getElementById('save').addEventListener('click', () => {
        const serverUrl = document.getElementById('serverUrl').value.replace(/\/$/, "");
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        chrome.storage.sync.set({ serverUrl, username, password }, () => {
            const status = document.getElementById('status');
            status.textContent = 'Options saved.';
            setTimeout(() => status.textContent = '', 2000);

            // Update import component config
            importSection.setAttribute('server-url', serverUrl);
            if (username && password) {
                const credentials = btoa(`${username}:${password}`);
                importSection.setAttribute('auth-header', `Basic ${credentials}`);
            } else {
                importSection.removeAttribute('auth-header');
            }
        });
    });
});
