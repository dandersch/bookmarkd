class BookmarkItem extends HTMLElement {
    static get observedAttributes() {
        return ['bookmark-id', 'url', 'title', 'category', 'category-id', 'favicon', 'timestamp'];
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
        this._categories = [];
        this._collapsedCategories = this._loadCollapsedState();
    }

    connectedCallback() {
        this.render();
    }

    setBookmarks(bookmarks) {
        this._bookmarks = bookmarks || [];
        this.render();
    }

    setCategories(categories) {
        this._categories = categories || [];
        this.render();
    }

    setData(bookmarks, categories) {
        this._bookmarks = bookmarks || [];
        this._categories = categories || [];
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

    _toggleCategory(categoryId) {
        this._collapsedCategories[categoryId] = !this._collapsedCategories[categoryId];
        this._saveCollapsedState();
        this.render();
    }

    _groupByCategory() {
        const groups = {};
        const categoryMap = {};

        for (const cat of this._categories) {
            categoryMap[cat.id] = cat;
            groups[cat.id] = [];
        }

        for (const bm of this._bookmarks) {
            const catId = bm.category_id || 'uncategorized';
            if (!groups[catId]) {
                groups[catId] = [];
            }
            groups[catId].push(bm);
        }

        const sortedCategories = [...this._categories].sort((a, b) => {
            if (a.id === 'uncategorized') return -1;
            if (b.id === 'uncategorized') return 1;
            return a.order - b.order;
        });

        return { groups, sortedCategories, categoryMap };
    }

    filterBookmarks(query) {
        const lowerQuery = query.toLowerCase();
        const sections = this.querySelectorAll('.collapse');
        
        sections.forEach(section => {
            const items = section.querySelectorAll('bookmark-item');
            const checkbox = section.querySelector('input[type="checkbox"]');
            const categoryId = section.dataset.categoryId;
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

            if (checkbox) {
                if (lowerQuery && hasVisibleItems) {
                    checkbox.checked = true;
                } else if (!lowerQuery) {
                    checkbox.checked = !this._collapsedCategories[categoryId];
                }
            }
            section.style.display = hasVisibleItems || !lowerQuery ? '' : 'none';
        });
    }

    render() {
        const { groups, sortedCategories, categoryMap } = this._groupByCategory();
        const hasBookmarks = this._bookmarks.length > 0;
        const hasCategories = this._categories.length > 0;

        if (!hasBookmarks && !hasCategories) {
            this.innerHTML = '<div class="bookmark-empty">No bookmarks yet</div>';
            return;
        }

        this.innerHTML = '';

        for (const category of sortedCategories) {
            const categoryId = category.id;
            const categoryName = category.name;
            const isCollapsed = this._collapsedCategories[categoryId];
            const isUncategorized = categoryId === 'uncategorized';
            const bookmarksInCategory = groups[categoryId] || [];

            const section = document.createElement('div');
            section.className = 'collapse collapse-arrow';
            section.dataset.categoryId = categoryId;
            section.draggable = !isUncategorized;

            if (!isUncategorized) {
                section.addEventListener('dragstart', (e) => {
                    if (e.target.closest('bookmark-item')) return;
                    e.dataTransfer.setData('category-id', categoryId);
                    e.dataTransfer.effectAllowed = 'move';
                    section.classList.add('category-dragging');
                });

                section.addEventListener('dragend', () => {
                    section.classList.remove('category-dragging');
                    this.querySelectorAll('.category-drag-over').forEach(el => el.classList.remove('category-drag-over'));
                });

                section.addEventListener('dragover', (e) => {
                    const draggedCategoryId = e.dataTransfer.types.includes('category-id');
                    if (!draggedCategoryId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    section.classList.add('category-drag-over');
                });

                section.addEventListener('dragleave', (e) => {
                    if (!section.contains(e.relatedTarget)) {
                        section.classList.remove('category-drag-over');
                    }
                });

                section.addEventListener('drop', (e) => {
                    const draggedCategoryId = e.dataTransfer.getData('category-id');
                    if (!draggedCategoryId || draggedCategoryId === categoryId) {
                        section.classList.remove('category-drag-over');
                        return;
                    }
                    e.preventDefault();
                    section.classList.remove('category-drag-over');
                    this._reorderCategories(draggedCategoryId, categoryId);
                });
            }

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = !isCollapsed;
            checkbox.addEventListener('change', () => this._toggleCategory(categoryId));
            section.appendChild(checkbox);

            const titleContainer = document.createElement('div');
            titleContainer.className = 'collapse-title text-xs font-semibold uppercase tracking-wider opacity-60 py-2 min-h-0 flex items-center justify-between pr-8';
            
            const titleText = document.createElement('span');
            titleText.className = 'category-name';
            titleText.textContent = categoryName;
            titleContainer.appendChild(titleText);

            section.appendChild(titleContainer);

            if (!isUncategorized) {
                const actions = document.createElement('div');
                actions.className = 'category-actions';
                actions.innerHTML = `
                    <button class="btn btn-ghost btn-xs btn-square drag-handle" title="Drag to reorder">⋮</button>
                    <button class="btn btn-ghost btn-xs btn-square edit-category-btn">✎</button>
                    <button class="btn btn-ghost btn-xs btn-square delete-category-btn">🗑</button>
                `;
                
                actions.querySelector('.edit-category-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._editCategory(categoryId, categoryName, section);
                });
                
                actions.querySelector('.delete-category-btn').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._deleteCategory(categoryName);
                });
                
                section.appendChild(actions);
            }

            const content = document.createElement('div');
            content.className = 'collapse-content';
            content.dataset.category = categoryName;
            content.dataset.categoryId = categoryId;

            if (bookmarksInCategory.length === 0) {
                const emptyDropZone = document.createElement('div');
                emptyDropZone.className = 'empty-drop-zone';
                emptyDropZone.textContent = 'Drop bookmarks here';
                content.appendChild(emptyDropZone);
            }

            for (const bm of bookmarksInCategory) {
                const item = document.createElement('bookmark-item');
                item.setAttribute('bookmark-id', bm.id);
                item.setAttribute('url', bm.url);
                item.setAttribute('title', bm.title);
                item.setAttribute('category', bm.category || categoryName);
                item.setAttribute('category-id', bm.category_id || categoryId);
                item.setAttribute('favicon', bm.favicon);
                item.setAttribute('timestamp', bm.timestamp || '');
                content.appendChild(item);
            }

            // Drop zone handlers
            content.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                content.classList.add('drag-over');
                
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

                const newCategoryId = content.dataset.categoryId;
                const newOrder = this._getDropOrder(content, bookmarkId);
                
                this._moveBookmark(bookmarkId, newCategoryId, newOrder);
            });

            section.appendChild(content);
            this.appendChild(section);
        }

        // Add "Add Category" row at the bottom
        const addCategoryRow = document.createElement('div');
        addCategoryRow.className = 'add-category-row';
        addCategoryRow.innerHTML = `
            <button class="btn btn-ghost btn-sm add-category-btn">
                <span class="add-category-icon">+</span>
                <span class="add-category-text">Add Category</span>
            </button>
        `;
        
        addCategoryRow.querySelector('.add-category-btn').addEventListener('click', () => {
            this._showAddCategoryInput(addCategoryRow);
        });
        
        this.appendChild(addCategoryRow);
    }

    _showAddCategoryInput(container) {
        container.innerHTML = `
            <div class="add-category-input-wrapper">
                <input type="text" class="input input-sm input-bordered add-category-input" placeholder="Category name...">
                <button class="btn btn-ghost btn-xs btn-square text-success save-category-btn">✓</button>
                <button class="btn btn-ghost btn-xs btn-square text-warning cancel-category-btn">✕</button>
            </div>
        `;

        const input = container.querySelector('.add-category-input');
        input.focus();

        const saveCategory = async () => {
            const name = input.value.trim();
            if (name) {
                await this._createCategory(name);
            } else {
                this.render();
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveCategory();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.render();
            }
        });

        container.querySelector('.save-category-btn').addEventListener('click', saveCategory);
        container.querySelector('.cancel-category-btn').addEventListener('click', () => this.render());
    }

    async _createCategory(name) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/categories/${encodeURIComponent(name)}`, {
                method: 'POST',
                headers
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'Failed to create category');
            }

            this.dispatchEvent(new CustomEvent('category-changed', { bubbles: true }));
        } catch (err) {
            console.error('Create category failed:', err);
            alert('Failed to create category: ' + err.message);
            this.render();
        }
    }

    _editCategory(categoryId, currentName, section) {
        const titleContainer = section.querySelector('.collapse-title');
        const titleText = titleContainer.querySelector('.category-name');
        const actions = section.querySelector('.category-actions');
        
        titleText.innerHTML = `<input type="text" class="input input-xs input-bordered category-edit-input" value="${this._escapeHtml(currentName)}">`;
        actions.innerHTML = `
            <button class="btn btn-ghost btn-xs btn-square text-success save-edit-btn">✓</button>
            <button class="btn btn-ghost btn-xs btn-square text-warning cancel-edit-btn">✕</button>
        `;
        actions.style.display = 'flex';

        const input = titleText.querySelector('.category-edit-input');
        input.focus();
        input.select();

        const saveEdit = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                await this._renameCategory(currentName, newName);
            } else {
                this.render();
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.render();
            }
        });

        input.addEventListener('click', (e) => e.stopPropagation());
        
        actions.querySelector('.save-edit-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveEdit();
        });
        
        actions.querySelector('.cancel-edit-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.render();
        });
    }

    async _renameCategory(oldName, newName) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/categories/${encodeURIComponent(oldName)}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ name: newName })
            });

            if (!res.ok) throw new Error('Failed to rename category');

            this.dispatchEvent(new CustomEvent('category-changed', { bubbles: true }));
        } catch (err) {
            console.error('Rename category failed:', err);
            this.render();
        }
    }

    async _deleteCategory(name) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = {};
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/categories/${encodeURIComponent(name)}`, {
                method: 'DELETE',
                headers
            });

            if (!res.ok) throw new Error('Failed to delete category');

            this.dispatchEvent(new CustomEvent('category-changed', { bubbles: true }));
        } catch (err) {
            console.error('Delete category failed:', err);
        }
    }

    async _reorderCategories(draggedId, targetId) {
        const currentOrder = this._categories
            .filter(c => c.id !== 'uncategorized')
            .sort((a, b) => a.order - b.order)
            .map(c => c.id);

        const draggedIndex = currentOrder.indexOf(draggedId);
        const targetIndex = currentOrder.indexOf(targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        currentOrder.splice(draggedIndex, 1);
        currentOrder.splice(targetIndex, 0, draggedId);

        const newOrder = ['uncategorized', ...currentOrder];

        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/categories/reorder`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ order: newOrder })
            });

            if (!res.ok) throw new Error('Failed to reorder categories');

            this.dispatchEvent(new CustomEvent('category-changed', { bubbles: true }));
        } catch (err) {
            console.error('Reorder categories failed:', err);
            this.render();
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

    async _moveBookmark(id, categoryId, order) {
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
                body: JSON.stringify({ category_id: categoryId, order })
            });

            if (!res.ok) throw new Error('Failed to move bookmark');

            this.dispatchEvent(new CustomEvent('bookmark-moved', { bubbles: true }));
        } catch (err) {
            console.error('Move failed:', err);
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

class SearchBar extends HTMLElement {
    static get observedAttributes() {
        return ['target', 'compact'];
    }

    connectedCallback() {
        this.render();
    }

    render() {
        const isCompact = this.hasAttribute('compact');
        const inputClass = isCompact
            ? 'input input-xs input-bordered bg-primary-content/10 border-primary-content/20 text-primary-content placeholder:text-primary-content/50 w-full focus:outline-none focus:border-primary-content/40'
            : 'input input-sm input-bordered bg-primary-content/10 border-primary-content/20 text-primary-content placeholder:text-primary-content/50 w-full max-w-xs focus:outline-none focus:border-primary-content/40';

        this.innerHTML = `<input type="text" class="${inputClass}" placeholder="Search...">`;

        const input = this.querySelector('input');
        input.addEventListener('input', (e) => {
            const query = e.target.value;
            this.dispatchEvent(new CustomEvent('search', { detail: query, bubbles: true }));

            const targetId = this.getAttribute('target');
            if (targetId) {
                const targetEl = document.getElementById(targetId);
                if (targetEl && typeof targetEl.filterBookmarks === 'function') {
                    targetEl.filterBookmarks(query);
                }
            }
        });
    }
}

customElements.define('bookmark-item', BookmarkItem);
customElements.define('bookmark-list', BookmarkList);
customElements.define('settings-import', SettingsImport);
customElements.define('search-bar', SearchBar);
