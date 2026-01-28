document.addEventListener('DOMContentLoaded', () => {
    const importSection = document.getElementById('import-section');
    const themeSelect = document.getElementById('theme-select');
    const themeCssInput = document.getElementById('theme-css-input');
    const addThemeBtn = document.getElementById('add-theme-btn');
    const themeStatus = document.getElementById('theme-status');
    const customThemesList = document.getElementById('custom-themes-list');

    // Inject custom themes and populate dropdown
    function loadCustomThemes(customThemes) {
        // Inject CSS
        let styleEl = document.getElementById('custom-themes-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'custom-themes-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = Object.values(customThemes).join('\n');

        // Add to dropdown
        for (const name of Object.keys(customThemes)) {
            if (!themeSelect.querySelector(`option[value="${name}"]`)) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                themeSelect.appendChild(opt);
            }
        }

        // Render list with delete buttons
        customThemesList.innerHTML = '';
        for (const name of Object.keys(customThemes)) {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-1';
            row.innerHTML = `
                <span class="text-sm">${name}</span>
                <button class="btn btn-ghost btn-xs text-error" data-theme="${name}">Delete</button>
            `;
            row.querySelector('button').addEventListener('click', () => deleteCustomTheme(name));
            customThemesList.appendChild(row);
        }
    }

    function deleteCustomTheme(name) {
        chrome.storage.sync.get(['customThemes', 'theme'], (items) => {
            const customThemes = items.customThemes || {};
            delete customThemes[name];
            chrome.storage.sync.set({ customThemes }, () => {
                loadCustomThemes(customThemes);
                // Reset theme if deleted
                if (items.theme === name) {
                    const defaultTheme = 'forest';
                    document.documentElement.setAttribute('data-theme', defaultTheme);
                    themeSelect.value = defaultTheme;
                    chrome.storage.sync.set({ theme: defaultTheme });
                }
                // Remove from dropdown
                const opt = themeSelect.querySelector(`option[value="${name}"]`);
                if (opt) opt.remove();
            });
        });
    }

    // Restore and configure
    chrome.storage.sync.get(['serverUrl', 'username', 'password', 'theme', 'customThemes'], (items) => {
        // Load custom themes first
        const customThemes = items.customThemes || {};
        loadCustomThemes(customThemes);

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

    // Add custom theme
    addThemeBtn.addEventListener('click', () => {
        const css = themeCssInput.value.trim();
        if (!css) return;

        const parsed = parseThemePlugin(css);
        if (!parsed) {
            themeStatus.textContent = 'Invalid theme CSS: could not parse name or variables';
            themeStatus.className = 'text-sm mt-2 text-error';
            return;
        }

        chrome.storage.sync.get(['customThemes'], (items) => {
            const customThemes = items.customThemes || {};
            customThemes[parsed.name] = parsed.css;

            chrome.storage.sync.set({ customThemes }, () => {
                themeStatus.textContent = `Theme "${parsed.name}" added!`;
                themeStatus.className = 'text-sm mt-2 text-success';
                themeCssInput.value = '';
                loadCustomThemes(customThemes);
            });
        });
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
