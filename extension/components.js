class BookmarkItem extends HTMLElement {
    static get observedAttributes() {
        return ['bookmark-id', 'url', 'title', 'category', 'category-id', 'favicon', 'timestamp', 'last-visited', 'notes', 'order'];
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
        const lastVisited = this.getAttribute('last-visited') || '';
        const addedTime = this.formatTimestamp(timestamp);
        const visitedTime = this.formatTimestamp(lastVisited);

        let hostname = '';
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            hostname = url;
        }

        this.className = 'bookmark-item';
        this.draggable = true;
        this.innerHTML = `
            <a href="${url}" target="_blank" class="bookmark-link" title="${this.escapeHtml(url)}">
                <img src="${favicon}" class="bookmark-favicon" alt="">
                <div class="bookmark-info">
                    <span class="bookmark-title">${this.escapeHtml(title)}</span>
                    <span class="bookmark-url">${hostname}</span>
                </div>
                <div class="bookmark-timestamps">
                    <span class="bookmark-timestamp">Added: ${addedTime}</span>
                    <span class="bookmark-visited">${visitedTime ? 'Visited: ' + visitedTime : ''}</span>
                </div>
            </a>
            <div class="bookmark-actions">
                <button class="btn btn-ghost btn-xs btn-square notes-btn" title="Notes">📝</button>
                <button class="btn btn-ghost btn-xs btn-square edit-btn">✎</button>
                <button class="btn btn-ghost btn-xs btn-square delete-btn">🗑</button>
            </div>
        `;

        const link = this.querySelector('.bookmark-link');
        link.addEventListener('click', () => {
            this.recordVisit();
        });

        this.querySelector('.notes-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openNotesModal();
        });

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
            // Clean up drop indicator when drag ends
            const list = this.closest('bookmark-list');
            if (list && list._hideDropIndicator) {
                list._hideDropIndicator();
            }
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

    recordVisit() {
        const id = this.getAttribute('bookmark-id');
        const config = this.getConfig();

        const headers = {};
        if (config.authHeader) headers['Authorization'] = config.authHeader;

        fetch(`${config.serverUrl}/api/bookmarks/${id}/visit`, {
            method: 'POST',
            headers
        }).catch(err => console.error('Failed to record visit:', err));
    }

    openNotesModal() {
        const id = this.getAttribute('bookmark-id');
        const title = this.getAttribute('title') || '';
        const notes = this.getAttribute('notes') || '';
        const config = this.getConfig();

        let modal = document.getElementById('notes-modal');
        if (!modal) {
            modal = document.createElement('dialog');
            modal.id = 'notes-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-box">
                    <form method="dialog">
                        <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
                    </form>
                    <h3 class="font-bold text-lg mb-4 notes-modal-title"></h3>
                    <textarea class="textarea textarea-bordered w-full h-32 notes-modal-textarea" placeholder="Add notes..." maxlength="1000"></textarea>
                    <div class="text-right text-xs text-base-content/50 mt-1"><span class="notes-modal-count">0</span> / 1000</div>
                </div>
                <form method="dialog" class="modal-backdrop">
                    <button>close</button>
                </form>
            `;
            document.body.appendChild(modal);

            const textarea = modal.querySelector('.notes-modal-textarea');
            const countEl = modal.querySelector('.notes-modal-count');

            textarea.addEventListener('input', () => {
                countEl.textContent = textarea.value.length;
            });

            textarea.addEventListener('blur', async () => {
                const currentId = modal.dataset.bookmarkId;
                const originalNotes = modal.dataset.originalNotes || '';
                const newNotes = textarea.value;
                if (newNotes === originalNotes) return;

                const item = document.querySelector(`bookmark-item[bookmark-id="${currentId}"]`);
                if (!item) return;
                const itemConfig = item.getConfig();

                try {
                    const headers = { 'Content-Type': 'application/json' };
                    if (itemConfig.authHeader) headers['Authorization'] = itemConfig.authHeader;

                    const res = await fetch(`${itemConfig.serverUrl}/api/bookmarks/${currentId}`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({ notes: newNotes })
                    });

                    if (!res.ok) throw new Error('Failed to save notes');

                    item.setAttribute('notes', newNotes);
                    modal.dataset.originalNotes = newNotes;
                } catch (err) {
                    console.error('Notes save failed:', err);
                }
            });

            modal.addEventListener('close', () => {
                textarea.dispatchEvent(new Event('blur'));
            });
        }

        modal.dataset.bookmarkId = id;
        modal.dataset.originalNotes = notes;
        modal.querySelector('.notes-modal-title').textContent = `Notes: ${this.escapeHtml(title)}`;
        const textarea = modal.querySelector('.notes-modal-textarea');
        textarea.value = notes;
        modal.querySelector('.notes-modal-count').textContent = notes.length;
        modal.showModal();
        textarea.focus();
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
            const categoryColor = category.color || '';
            const isCollapsed = this._collapsedCategories[categoryId];
            const isUncategorized = categoryId === 'uncategorized';
            const bookmarksInCategory = groups[categoryId] || [];

            const section = document.createElement('div');
            section.className = 'collapse collapse-arrow';
            section.dataset.categoryId = categoryId;
            section.dataset.categoryColor = categoryColor;
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
            if (categoryColor) {
                titleContainer.style.backgroundColor = categoryColor;
                titleContainer.style.opacity = '1';
            }
            
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
            if (categoryColor) {
                content.style.backgroundColor = this._darkenColor(categoryColor, 0.5);
            }

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
                item.setAttribute('last-visited', bm.last_visited || '');
                item.setAttribute('notes', bm.notes || '');
                item.setAttribute('order', bm.order ?? 0);
                content.appendChild(item);
            }

            // Drop zone handlers
            content.addEventListener('dragover', (e) => {
                if (!e.dataTransfer.types.includes('bookmark-id')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                content.classList.add('drag-over');
                
                const afterElement = this._getDragAfterElement(content, e.clientY, e.clientX);
                this._showDropIndicator(content, afterElement);
                this._autoScroll(e.clientY);
            });

            content.addEventListener('dragleave', (e) => {
                if (!content.contains(e.relatedTarget)) {
                    content.classList.remove('drag-over');
                    this._hideDropIndicator();
                }
            });

            content.addEventListener('drop', (e) => {
                e.preventDefault();
                content.classList.remove('drag-over');
                this._hideDropIndicator();
                
                const bookmarkId = e.dataTransfer.getData('bookmark-id');
                if (!bookmarkId) return;

                const draggedEl = this.querySelector(`bookmark-item[bookmark-id="${bookmarkId}"]`);
                if (!draggedEl) return;

                const afterElement = this._getDragAfterElement(content, e.clientY, e.clientX);
                const targetCategoryId = content.dataset.categoryId;
                const newOrder = this._computeDropOrder(content, draggedEl, afterElement, targetCategoryId);
                
                this._moveBookmark(bookmarkId, targetCategoryId, newOrder);
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
                <input type="color" class="add-category-color-input" value="#808080" title="Category color">
                <button class="btn btn-ghost btn-xs btn-square text-success save-category-btn">✓</button>
                <button class="btn btn-ghost btn-xs btn-square text-warning cancel-category-btn">✕</button>
            </div>
        `;

        const input = container.querySelector('.add-category-input');
        const colorInput = container.querySelector('.add-category-color-input');
        input.focus();

        const saveCategory = async () => {
            const name = input.value.trim();
            const color = colorInput.value;
            if (name) {
                await this._createCategory(name, color);
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

    async _createCategory(name, color) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const res = await fetch(`${config.serverUrl}/api/categories/${encodeURIComponent(name)}`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ color })
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
        const checkbox = section.querySelector('input[type="checkbox"]');
        const currentColor = section.dataset.categoryColor || '#808080';
        
        // Disable checkbox to allow clicking on inputs
        if (checkbox) checkbox.style.display = 'none';
        
        titleText.innerHTML = `
            <span style="display: flex; align-items: center; gap: 0.5rem;">
                <input type="text" class="input input-xs input-bordered category-edit-input" value="${this._escapeHtml(currentName)}">
                <input type="color" class="category-color-input" value="${currentColor}" title="Category color">
            </span>
        `;
        
        actions.innerHTML = `
            <button class="btn btn-ghost btn-xs btn-square text-success save-edit-btn">✓</button>
            <button class="btn btn-ghost btn-xs btn-square text-warning cancel-edit-btn">✕</button>
        `;
        actions.style.display = 'flex';

        const input = titleText.querySelector('.category-edit-input');
        const colorInput = titleText.querySelector('.category-color-input');
        input.focus();
        input.select();

        const saveEdit = async () => {
            const newName = input.value.trim();
            const newColor = colorInput.value;
            if (newName) {
                await this._updateCategory(currentName, newName, newColor);
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
        colorInput.addEventListener('click', (e) => e.stopPropagation());
        
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

    async _updateCategory(oldName, newName, color) {
        const config = {
            serverUrl: this.getAttribute('server-url') || '',
            authHeader: this.getAttribute('auth-header') || ''
        };

        try {
            const headers = { 'Content-Type': 'application/json' };
            if (config.authHeader) headers['Authorization'] = config.authHeader;

            const payload = {};
            if (newName !== oldName) payload.name = newName;
            if (color) payload.color = color;

            const res = await fetch(`${config.serverUrl}/api/categories/${encodeURIComponent(oldName)}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Failed to update category');

            this.dispatchEvent(new CustomEvent('category-changed', { bubbles: true }));
        } catch (err) {
            console.error('Update category failed:', err);
            this.render();
        }
    }

    _darkenColor(hex, factor) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const darken = (c) => Math.round(c * (1 - factor));
        return `rgb(${darken(r)}, ${darken(g)}, ${darken(b)})`;
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

    _getDragAfterElement(container, y, x) {
        const items = [...container.querySelectorAll('bookmark-item:not(.dragging)')];
        const isGrid = getComputedStyle(container).display === 'grid';
        
        if (!isGrid) {
            // Vertical list: use Y only
            return items.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset, element: child };
                }
                return closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }
        
        // Grid layout: find closest item based on position
        let closest = null;
        let closestDist = Infinity;
        
        for (const child of items) {
            const box = child.getBoundingClientRect();
            const centerX = box.left + box.width / 2;
            const centerY = box.top + box.height / 2;
            
            // Only consider items that are after the cursor position
            // (below current row, or same row but to the right)
            if (y < box.bottom && (y >= box.top || x < centerX)) {
                const dist = Math.hypot(x - centerX, y - centerY);
                if (dist < closestDist && (x < centerX || y < centerY)) {
                    closestDist = dist;
                    closest = child;
                }
            }
        }
        
        return closest;
    }

    _getOrderAttr(el) {
        const v = el?.getAttribute('order');
        return v == null ? null : parseInt(v, 10);
    }

    _computeDropOrder(container, draggedEl, afterElement, targetCategoryId) {
        const sourceCategoryId = draggedEl.getAttribute('category-id');
        const sourceOrder = this._getOrderAttr(draggedEl) ?? 0;

        // If dropping before some element
        if (afterElement) {
            const targetOrder = this._getOrderAttr(afterElement) ?? 0;
            
            // When moving DOWN within same category, subtract 1
            // because removing from above shifts target up
            if (targetCategoryId === sourceCategoryId && targetOrder > sourceOrder) {
                return targetOrder - 1;
            }
            return targetOrder;
        }

        // Dropping at end
        const others = [...container.querySelectorAll('bookmark-item:not(.dragging)')];
        const maxOtherOrder = others.reduce((m, el) => {
            const o = this._getOrderAttr(el);
            return o == null ? m : Math.max(m, o);
        }, -1);

        if (targetCategoryId === sourceCategoryId) {
            // Same category: return max order (not max+1 to avoid gaps)
            return Math.max(sourceOrder, maxOtherOrder);
        }

        // Cross-category: append at end
        return maxOtherOrder + 1;
    }

    _ensureDropIndicator() {
        if (this._dropIndicator) return;
        const el = document.createElement('div');
        el.className = 'bookmark-drop-indicator';
        document.body.appendChild(el);
        this._dropIndicator = el;
    }

    _showDropIndicator(container, beforeEl) {
        this._ensureDropIndicator();
        const isGrid = getComputedStyle(container).display === 'grid';
        
        if (beforeEl) {
            const box = beforeEl.getBoundingClientRect();
            if (isGrid) {
                // Vertical line on left side of target element
                this._dropIndicator.style.width = '3px';
                this._dropIndicator.style.height = box.height + 'px';
                this._dropIndicator.style.left = (box.left - 4) + 'px';
                this._dropIndicator.style.top = box.top + 'px';
            } else {
                // Horizontal line above target element
                this._dropIndicator.style.width = box.width + 'px';
                this._dropIndicator.style.height = '3px';
                this._dropIndicator.style.left = box.left + 'px';
                this._dropIndicator.style.top = (box.top - 4) + 'px';
            }
        } else {
            // Dropping at end - show after last item
            const items = container.querySelectorAll('bookmark-item');
            const lastItem = items[items.length - 1];
            if (lastItem) {
                const box = lastItem.getBoundingClientRect();
                if (isGrid) {
                    this._dropIndicator.style.width = '3px';
                    this._dropIndicator.style.height = box.height + 'px';
                    this._dropIndicator.style.left = (box.right + 4) + 'px';
                    this._dropIndicator.style.top = box.top + 'px';
                } else {
                    this._dropIndicator.style.width = box.width + 'px';
                    this._dropIndicator.style.height = '3px';
                    this._dropIndicator.style.left = box.left + 'px';
                    this._dropIndicator.style.top = (box.bottom + 4) + 'px';
                }
            } else {
                this._hideDropIndicator();
                return;
            }
        }
        this._dropIndicator.style.display = 'block';
    }

    _hideDropIndicator() {
        if (!this._dropIndicator) return;
        this._dropIndicator.style.display = 'none';
    }

    _autoScroll(clientY) {
        const margin = 80;
        const speed = 15;
        const scroller = document.scrollingElement || document.documentElement;

        if (clientY < margin) {
            scroller.scrollTop -= speed;
        } else if (window.innerHeight - clientY < margin) {
            scroller.scrollTop += speed;
        }
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
        const hasBookmarksApi = (typeof chrome !== 'undefined' && chrome.bookmarks) || 
                                 (typeof browser !== 'undefined' && browser.bookmarks);

        this.innerHTML = `
            <div class="settings-import">
                <label class="block mb-2 font-semibold">Import Bookmarks</label>
                <p class="text-sm opacity-70 mb-3">Import from browser bookmark export (HTML format)</p>
                <input type="file" accept=".html,.htm" class="file-input file-input-bordered file-input-sm w-full max-w-xs import-file">
                <div class="import-status mt-3 text-sm"></div>

                ${hasBookmarksApi ? `
                <div class="divider before:bg-base-300 after:bg-base-300 my-4"></div>

                <label class="block mb-2 font-semibold">Import from Browser</label>
                <p class="text-sm opacity-70 mb-3">Import bookmarks directly from your browser</p>
                <button class="btn btn-sm btn-outline browser-import-btn">Import Browser Bookmarks</button>
                <div class="browser-import-status mt-3 text-sm"></div>
                ` : ''}
            </div>
        `;

        this.querySelector('.import-file').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        if (hasBookmarksApi) {
            this.querySelector('.browser-import-btn').addEventListener('click', () => {
                this.handleBrowserImport();
            });
        }
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

    async importBookmarks(bookmarks, statusEl = null) {
        const config = this.getConfig();
        const results = [];
        const total = bookmarks.length;

        for (let i = 0; i < bookmarks.length; i++) {
            const bm = bookmarks[i];
            if (statusEl) {
                statusEl.textContent = `Importing ${i + 1}/${total}...`;
            }
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

    async handleBrowserImport() {
        const statusEl = this.querySelector('.browser-import-status');
        const btn = this.querySelector('.browser-import-btn');
        
        statusEl.textContent = 'Reading browser bookmarks...';
        statusEl.className = 'browser-import-status mt-3 text-sm';
        btn.disabled = true;

        try {
            const bookmarksApi = typeof browser !== 'undefined' ? browser.bookmarks : chrome.bookmarks;
            
            if (!bookmarksApi) {
                throw new Error('Bookmarks API not available');
            }

            const existingUrls = await this.fetchExistingUrls();
            const tree = await bookmarksApi.getTree();
            const bookmarks = this.flattenBookmarkTree(tree[0]);

            if (bookmarks.length === 0) {
                statusEl.textContent = 'No bookmarks found in browser';
                statusEl.classList.add('text-warning');
                btn.disabled = false;
                return;
            }

            const newBookmarks = bookmarks.filter(bm => !existingUrls.has(bm.url));
            const skipped = bookmarks.length - newBookmarks.length;

            if (newBookmarks.length === 0) {
                statusEl.textContent = `All ${bookmarks.length} bookmarks already exist`;
                statusEl.classList.add('text-info');
                btn.disabled = false;
                return;
            }

            statusEl.textContent = `Found ${newBookmarks.length} new bookmarks (${skipped} duplicates skipped). Importing...`;

            const results = await this.importBookmarks(newBookmarks, statusEl);
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            if (failed === 0) {
                statusEl.textContent = `Imported ${successful} bookmarks` + (skipped > 0 ? ` (${skipped} duplicates skipped)` : '');
                statusEl.classList.add('text-success');
            } else {
                statusEl.textContent = `Imported ${successful}, ${failed} failed` + (skipped > 0 ? `, ${skipped} skipped` : '');
                statusEl.classList.add('text-warning');
            }

            this.dispatchEvent(new CustomEvent('import-complete', {
                detail: { successful, failed, skipped },
                bubbles: true
            }));

        } catch (err) {
            console.error('Browser import failed:', err);
            statusEl.textContent = 'Import failed: ' + err.message;
            statusEl.classList.add('text-error');
        }

        btn.disabled = false;
    }

    async fetchExistingUrls() {
        const config = this.getConfig();
        const headers = {};
        if (config.authHeader) headers['Authorization'] = config.authHeader;

        try {
            const res = await fetch(`${config.serverUrl}/api/bookmarks`, { headers });
            if (!res.ok) return new Set();
            const bookmarks = await res.json();
            return new Set(bookmarks.map(bm => bm.url));
        } catch {
            return new Set();
        }
    }

    flattenBookmarkTree(node, parentFolder = 'Uncategorized') {
        const bookmarks = [];

        if (node.url) {
            if (node.url.startsWith('http://') || node.url.startsWith('https://')) {
                bookmarks.push({
                    url: node.url,
                    title: node.title || node.url,
                    category: parentFolder
                });
            }
        }

        if (node.children) {
            const folderName = node.title || parentFolder;
            for (const child of node.children) {
                const isFolder = !child.url && child.children;
                const childFolder = isFolder ? parentFolder : folderName;
                bookmarks.push(...this.flattenBookmarkTree(child, node.title ? folderName : parentFolder));
            }
        }

        return bookmarks;
    }
}

class SearchBar extends HTMLElement {
    static get observedAttributes() {
        return ['target', 'compact', 'count'];
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback(name) {
        if (name === 'count') {
            this.render();
        }
    }

    render() {
        const isCompact = this.hasAttribute('compact');
        const count = this.getAttribute('count');
        const placeholder = count ? `Search ${count} bookmarks...` : 'Search...';
        const inputClass = isCompact
            ? 'input input-xs input-bordered bg-primary-content/10 border-primary-content/20 text-primary-content placeholder:text-primary-content/50 w-full focus:outline-none focus:border-primary-content/40'
            : 'input input-lg input-bordered bg-primary-content/10 border-primary-content/20 text-primary-content placeholder:text-primary-content/50 w-full focus:outline-none focus:border-primary-content/40';

        this.innerHTML = `<input type="text" class="${inputClass}" placeholder="${placeholder}">`;

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

// Theme parsing utility - converts @plugin format to runtime CSS
function parseThemePlugin(cssText) {
    const nameMatch = cssText.match(/name:\s*["']([^"']+)["']/);
    if (!nameMatch) return null;

    const themeName = nameMatch[1];
    const varLines = [];

    const colorSchemeMatch = cssText.match(/color-scheme:\s*["']([^"']+)["']/);
    if (colorSchemeMatch) {
        varLines.push(`color-scheme: ${colorSchemeMatch[1]};`);
    }

    const varMatches = cssText.matchAll(/(--[\w-]+):\s*([^;]+);/g);
    for (const match of varMatches) {
        varLines.push(`${match[1]}: ${match[2]};`);
    }

    if (varLines.length === 0) return null;

    return {
        name: themeName,
        css: `[data-theme="${themeName}"] {\n  ${varLines.join('\n  ')}\n}`
    };
}

window.parseThemePlugin = parseThemePlugin;
