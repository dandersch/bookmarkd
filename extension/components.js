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
        this.innerHTML = `
            <a href="${url}" target="_blank" class="bookmark-link">
                <img src="${favicon}" class="bookmark-favicon" alt="">
                <span class="bookmark-title">${this.escapeHtml(title)}</span>
                <span class="bookmark-url">${hostname}</span>
                <span class="bookmark-timestamp">${timeAgo}</span>
                <span class="bookmark-category badge badge-sm">${category}</span>
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
            <span class="bookmark-category badge badge-sm">${category}</span>
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
    }

    connectedCallback() {
        this.render();
    }

    setBookmarks(bookmarks) {
        this._bookmarks = bookmarks || [];
        this.render();
    }

    filterBookmarks(query) {
        const items = this.querySelectorAll('bookmark-item');
        const lowerQuery = query.toLowerCase();
        
        items.forEach(item => {
            const title = (item.getAttribute('title') || '').toLowerCase();
            const url = (item.getAttribute('url') || '').toLowerCase();
            const category = (item.getAttribute('category') || '').toLowerCase();
            
            const matches = title.includes(lowerQuery) || 
                           url.includes(lowerQuery) || 
                           category.includes(lowerQuery);
            
            item.style.display = matches ? '' : 'none';
        });
    }

    render() {
        if (this._bookmarks.length === 0) {
            this.innerHTML = '<div class="bookmark-empty">No bookmarks yet</div>';
            return;
        }

        this.innerHTML = '';
        for (const bm of this._bookmarks) {
            const item = document.createElement('bookmark-item');
            item.setAttribute('bookmark-id', bm.id);
            item.setAttribute('url', bm.url);
            item.setAttribute('title', bm.title);
            item.setAttribute('category', bm.category);
            item.setAttribute('favicon', bm.favicon);
            item.setAttribute('timestamp', bm.timestamp || '');
            this.appendChild(item);
        }
    }
}

customElements.define('bookmark-item', BookmarkItem);
customElements.define('bookmark-list', BookmarkList);
