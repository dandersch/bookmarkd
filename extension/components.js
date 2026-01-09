class BookmarkItem extends HTMLElement {
    static get observedAttributes() {
        return ['bookmark-id', 'url', 'title', 'category', 'favicon'];
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

    render() {
        const id = this.getAttribute('bookmark-id') || '';
        const url = this.getAttribute('url') || '';
        const title = this.getAttribute('title') || '';
        const category = this.getAttribute('category') || 'Uncategorized';
        const favicon = this.getAttribute('favicon') || '';

        this.className = 'group list-row p-2 flex hover:bg-gray-700 relative items-center';
        this.innerHTML = `
            <input type="hidden" name="id" value="${id}">
            <img src="${favicon}" class="size-5 flex-none" alt="icon">
            <a href="${url}" target="_blank" class="flex-grow text-sm block truncate after:absolute after:inset-0 group-hover:after:right-16">${title}</a>
            <span class="badge bg-gray-600 badge-xs mt-1 flex-none">${category}</span>
            <div class="hidden group-hover:flex items-center relative z-10 ml-2">
                <button class="btn btn-ghost btn-xs btn-square text-info edit-btn">✎</button>
                <button class="btn btn-ghost btn-xs btn-square text-error delete-btn">🗑</button>
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

        this.className = 'list-row p-2 flex relative items-center bg-base-200';
        this.innerHTML = `
            <input type="hidden" name="id" value="${id}">
            <img src="${favicon}" class="size-5 flex-none" alt="icon">
            <input type="text" class="input input-sm input-bordered flex-grow text-sm mx-2 title-input" value="${this.escapeHtml(title)}">
            <span class="badge bg-gray-600 badge-xs flex-none">${category}</span>
            <div class="flex items-center relative z-10 ml-2">
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

    render() {
        if (this._bookmarks.length === 0) {
            this.innerHTML = '<li class="p-2 text-center text-base-content/50 text-sm">No bookmarks yet</li>';
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
            this.appendChild(item);
        }
    }
}

customElements.define('bookmark-item', BookmarkItem);
customElements.define('bookmark-list', BookmarkList);
