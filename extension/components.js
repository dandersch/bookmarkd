class BookmarkItem extends HTMLElement {
    static get observedAttributes() {
        return ['bookmark-id', 'url', 'title', 'category', 'favicon', 'timestamp'];
    }

    constructor() {
        super();
        this._editing = false;
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback() {
        if (!this._editing) {
            this.render();
        }
    }

    getConfig() {
        const list = this.closest('bookmark-list');
        return {
            serverUrl: list?.getAttribute('server-url') || '',
            authHeader: list?.getAttribute('auth-header') || ''
        };
    }

    formatTimestamp(ts) {
        if (!ts) return '';
        const date = new Date(parseInt(ts) * 1000);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        return date.toLocaleDateString();
    }

    render() {
        const id = this.getAttribute('bookmark-id') || '';
        const url = this.getAttribute('url') || '';
        const title = this.getAttribute('title') || '';
        const category = this.getAttribute('category') || 'Uncategorized';
        const favicon = this.getAttribute('favicon') || '';
        const timestamp = this.getAttribute('timestamp') || '';
        const timeAgo = this.formatTimestamp(timestamp);

        let hostname = '';
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = url;
        }

        this.className = 'bookmark-item';
        this.draggable = true;
        this.innerHTML = `
            <a href="${url}" target="_blank" class="bookmark-link">
                <img src="${favicon}" class="bookmark-favicon" alt="">
                <span class="bookmark-title">${this.escapeHtml(title)}</span>
                <span class="bookmark-url">${hostname}</span>
                <span class="bookmark-timestamp">${timeAgo}</span>
            </a>
            <div class="bookmark-actions">
                <button class="btn btn-ghost btn-xs btn-square edit-btn">✎</button>
                <button class="btn btn-ghost btn-xs btn-square delete-btn">🗑</button>
            </div>
        `;

        this.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.enterEditMode();
        });

        this.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.deleteBookmark();
        });

        // Drag and drop
        this.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('bookmark-id', id);
            e.dataTransfer.effectAllowed = 'move';
            this.classList.add('dragging');
        });

        this.addEventListener('dragend', () => {
            this.classList.remove('dragging');
        });
    }

    enterEditMode() {
        this._editing = true;
        const id = this.getAttribute('bookmark-id') || '';
        const title = this.getAttribute('title') || '';
        const favicon = this.getAttribute('favicon') || '';
        const category = this.getAttribute('category') || 'Uncategorized';

        this.className = 'bookmark-item editing';
        this.innerHTML = `
            <img src="${favicon}" class="bookmark-favicon" alt="">
            <input type="text" class="input input-sm input-bordered flex-grow title-input" value="${this.escapeHtml(title)}">
            <div class="bookmark-actions editing">
                <button class="btn btn-ghost btn-xs btn-square text-success save-btn">✓</button>
                <button class="btn btn-ghost btn-xs btn-square text-warning cancel-btn">✕</button>
            </div>
        `;

        const input = this.querySelector('.title-input');
        input.focus();
        input.select();

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelEdit();
            }
        });

        this.querySelector('.save-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.saveEdit();
        });

        this.querySelector('.cancel-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.cancelEdit();
        });
    }

    async saveEdit() {
        const input = this.querySelector('.title-input');
        const newTitle = input.value.trim();
        if (!newTitle) {
            this.cancelEdit();
            return;
        }

        const id = this.getAttribute('bookmark-id');
        const config = this.getConfig();

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/bookmarks/${id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ title: newTitle })
            });

            if (!res.ok) throw new Error('Failed to update');

            this.setAttribute('title', newTitle);
            this._editing = false;
            this.render();
        } catch (err) {
            console.error('Update failed:', err);
            this.cancelEdit();
        }
    }

    cancelEdit() {
        this._editing = false;
        this.render();
    }

    async deleteBookmark() {
        const id = this.getAttribute('bookmark-id');
        const config = this.getConfig();

        try {
            const headers = {};
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/bookmarks/${id}`, {
                method: 'DELETE',
                headers
            });

            if (!res.ok) throw new Error('Failed to delete');

            this.remove();
        } catch (err) {
            console.error('Delete failed:', err);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/"/g, '&quot;');
    }
}

class BookmarkList extends HTMLElement {
    constructor() {
        super();
        this._bookmarks = [];
        this._collapsedCategories = this._loadCollapsedState();
    }

    connectedCallback() {
        this.render();
    }

    setBookmarks(bookmarks) {
        this._bookmarks = bookmarks || [];
        this.render();
    }

    _loadCollapsedState() {
        try {
            const saved = localStorage.getItem('bookmarkd-collapsed-categories');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    }

    _saveCollapsedState() {
        try {
            localStorage.setItem('bookmarkd-collapsed-categories', JSON.stringify(this._collapsedCategories));
        } catch {}
    }

    _toggleCategory(category) {
        this._collapsedCategories[category] = !this._collapsedCategories[category];
        this._saveCollapsedState();
        this.render();
    }

    _groupByCategory() {
        const groups = {};
        for (const bm of this._bookmarks) {
            const cat = bm.category || 'Uncategorized';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(bm);
        }
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'Uncategorized') return -1;
            if (b === 'Uncategorized') return 1;
            return a.localeCompare(b);
        });
        return { groups, sortedKeys };
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();
        const sections = this.querySelectorAll('.collapse');
        
        sections.forEach(section => {
            const items = section.querySelectorAll('bookmark-item');
            const checkbox = section.querySelector('input[type="checkbox"]');
            let hasVisibleItems = false;
            
            items.forEach(item => {
                const title = (item.getAttribute('title') || '').toLowerCase();
                const url = (item.getAttribute('url') || '').toLowerCase();
                const category = (item.getAttribute('category') || '').toLowerCase();
                
                const matches = title.includes(lowerQuery) || 
                               url.includes(lowerQuery) || 
                               category.includes(lowerQuery);
                
                item.style.display = matches ? '' : 'none';
                if (matches) hasVisibleItems = true;
            });

            if (lowerQuery && hasVisibleItems && checkbox) {
                checkbox.checked = true;
            }
            section.style.display = hasVisibleItems || !lowerQuery ? '' : 'none';
        });
    }

    render() {
        if (this._bookmarks.length === 0) {
            this.innerHTML = '<div class="bookmark-empty">No bookmarks yet</div>';
            return;
        }

        const { groups, sortedKeys } = this._groupByCategory();
        this.innerHTML = '';

        for (const category of sortedKeys) {
            const isCollapsed = this._collapsedCategories[category];
            
            const section = document.createElement('div');
            section.className = 'collapse collapse-arrow';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !isCollapsed;
            checkbox.addEventListener('change', () => this._toggleCategory(category));
            section.appendChild(checkbox);

            const title = document.createElement('div');
            title.className = 'collapse-title text-xs font-semibold uppercase tracking-wider opacity-60 py-2 min-h-0';
            title.textContent = category;
            section.appendChild(title);

            const content = document.createElement('div');
            content.className = 'collapse-content';
            content.dataset.category = category;

            for (const bm of groups[category]) {
                const item = document.createElement('bookmark-item');
                item.setAttribute('bookmark-id', bm.id);
                item.setAttribute('url', bm.url);
                item.setAttribute('title', bm.title);
                item.setAttribute('category', bm.category);
                item.setAttribute('favicon', bm.favicon);
                item.setAttribute('timestamp', bm.timestamp || '');
                content.appendChild(item);
            }

            // Drop zone handlers
            content.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                content.classList.add('drag-over');
                
                // Show drop indicator
                const afterElement = this._getDragAfterElement(content, e.clientY);
                const dragging = document.querySelector('.dragging');
                if (dragging) {
                    if (afterElement) {
                        content.insertBefore(dragging, afterElement);
                    } else {
                        content.appendChild(dragging);
                    }
                }
            });

            content.addEventListener('dragleave', (e) => {
                if (!content.contains(e.relatedTarget)) {
                    content.classList.remove('drag-over');
                }
            });

            content.addEventListener('drop', (e) => {
                e.preventDefault();
                content.classList.remove('drag-over');
                
                const bookmarkId = e.dataTransfer.getData('bookmark-id');
                if (!bookmarkId) return;

                const newCategory = content.dataset.category;
                const newOrder = this._getDropOrder(content, bookmarkId);
                
                this._moveBookmark(bookmarkId, newCategory, newOrder);
            });

            section.appendChild(content);
            this.appendChild(section);
        }
    }

    _getDragAfterElement(container, y) {
        const items = [...container.querySelectorAll('bookmark-item:not(.dragging)')];
        
        return items.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    _getDropOrder(container, draggedId) {
        const items = [...container.querySelectorAll('bookmark-item')];
        for (let i = 0; i < items.length; i++) {
            if (items[i].getAttribute('bookmark-id') === draggedId) {
                return i;
            }
        }
        return items.length;
    }

    async _moveBookmark(id, category, order) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/bookmarks/${id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ category, order })
            });

            if (!res.ok) throw new Error('Failed to move bookmark');

            // Refresh bookmarks from server
            this.dispatchEvent(new CustomEvent('bookmark-moved', { bubbles: true }));
        } catch (err) {
            console.error('Move failed:', err);
            // Re-render to reset positions
            this.render();
        }
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

class SettingsImport extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {
        this.render();
    }

    getConfig() {
        return {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };
    }

    render() {
        this.innerHTML = `
            <div class="settings-import">
                <label class="block mb-2 font-semibold">Import Bookmarks</label>
                <p class="text-sm opacity-70 mb-3">Import from browser bookmark export (HTML format)</p>
                <input type="file" accept=".html,.htm" class="file-input file-input-bordered file-input-sm w-full max-w-xs import-file">
                <div class="import-status mt-3 text-sm"></div>
            </div>
        `;

        this.querySelector('.import-file').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });
    }

    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        const statusEl = this.querySelector('.import-status');
        statusEl.textContent = 'Reading file...';
        statusEl.className = 'import-status mt-3 text-sm';

        try {
            const text = await file.text();
            const bookmarks = this.parseNetscapeHTML(text);
            
            if (bookmarks.length === 0) {
                statusEl.textContent = 'No bookmarks found in file';
                statusEl.classList.add('text-warning');
                return;
            }

            statusEl.textContent = `Found ${bookmarks.length} bookmarks. Importing...`;
            
            const results = await this.importBookmarks(bookmarks);
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            if (failed === 0) {
                statusEl.textContent = `Successfully imported ${successful} bookmarks`;
                statusEl.classList.add('text-success');
            } else {
                statusEl.textContent = `Imported ${successful} bookmarks, ${failed} failed`;
                statusEl.classList.add('text-warning');
            }

            this.dispatchEvent(new CustomEvent('import-complete', { 
                detail: { successful, failed },
                bubbles: true 
            }));

        } catch (err) {
            console.error('Import failed:', err);
            statusEl.textContent = 'Import failed: ' + err.message;
            statusEl.classList.add('text-error');
        }

        e.target.value = '';
    }

    parseNetscapeHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const bookmarks = [];
        
        const links = doc.querySelectorAll('a[href]');
        let currentFolder = 'Uncategorized';

        const processNode = (node, folder) => {
            if (node.tagName === 'H3') {
                return node.textContent.trim();
            }
            if (node.tagName === 'A' && node.href) {
                const url = node.getAttribute('href');
                if (url && url.startsWith('http')) {
                    bookmarks.push({
                        url: url,
                        title: node.textContent.trim() || url,
                        category: folder,
                        timestamp: node.getAttribute('add_date') || '',
                        favicon: node.getAttribute('icon') || node.getAttribute('icon_uri') || ''
                    });
                }
            }
            return folder;
        };

        const walk = (element, folder) => {
            for (const child of element.children) {
                if (child.tagName === 'DT') {
                    for (const dtChild of child.children) {
                        if (dtChild.tagName === 'H3') {
                            folder = dtChild.textContent.trim();
                        } else if (dtChild.tagName === 'A') {
                            processNode(dtChild, folder);
                        } else if (dtChild.tagName === 'DL') {
                            walk(dtChild, folder);
                        }
                    }
                } else if (child.tagName === 'DL') {
                    walk(child, folder);
                }
            }
        };

        const dl = doc.querySelector('dl');
        if (dl) {
            walk(dl, 'Uncategorized');
        }

        return bookmarks;
    }

    async importBookmarks(bookmarks) {
        const config = this.getConfig();
        const results = [];

        for (const bm of bookmarks) {
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (config.authHeader) headers['Authorization'] = config.authHeader;

                const res = await fetch(`${config.serverUrl}/api/bookmarks`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        url: bm.url,
                        title: bm.title,
                        category: bm.category,
                        favicon: bm.favicon || ''
                    })
                });

                results.push({ success: res.ok, bookmark: bm });
            } catch (err) {
                results.push({ success: false, bookmark: bm, error: err });
            }
        }

        return results;
    }
}

customElements.define('bookmark-item', BookmarkItem);
customElements.define('bookmark-list', BookmarkList);
customElements.define('settings-import', SettingsImport);
