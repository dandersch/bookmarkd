class BookmarkItem extends HTMLElement {
    static get observedAttributes() {
        return ['bookmark-id', 'url', 'title', 'category', 'favicon'];
    }

    constructor() {
        super();
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback() {
        this.render();
    }

    render() {
        const id = this.getAttribute('bookmark-id') || '';
        const url = this.getAttribute('url') || '';
        const title = this.getAttribute('title') || '';
        const category = this.getAttribute('category') || 'Uncategorized';
        const favicon = this.getAttribute('favicon') || '';

        this.className = 'list-row p-2 flex hover:bg-blue-500 relative';
        this.innerHTML = `
            <input type="hidden" name="id" value="${id}">
            <img src="${favicon}" class="size-5 flex-none" alt="icon">
            <a href="${url}" target="_blank" class="flex-grow text-sm block truncate after:absolute after:inset-0">${title}</a>
            <span class="badge bg-gray-600 badge-xs mt-1 flex-none">${category}</span>
        `;
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
