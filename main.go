package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
	"github.com/google/uuid"
)

// Data Models
type Bookmark struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	Category  string `json:"category"`
	Timestamp int64  `json:"timestamp"`
	Favicon   string `json:"favicon"`
	Order     int    `json:"order"`
}

const dbFile = "bookmarks.json"

var (
	bookmarks map[string]Bookmark
	mu        sync.RWMutex // Protects the bookmarks map during concurrent reads/writes
)

// bookmarksToSortedSlice converts the map to a slice sorted by category, then order, then timestamp
// Must be called while holding mu.RLock()
func bookmarksToSortedSlice() []Bookmark {
	if len(bookmarks) == 0 {
		return []Bookmark{}
	}

	result := make([]Bookmark, 0, len(bookmarks))
	for _, bm := range bookmarks {
		result = append(result, bm)
	}

	// Sort by: category (Uncategorized first, then alpha), order asc, timestamp desc
	sort.Slice(result, func(i, j int) bool {
		ci, cj := result[i].Category, result[j].Category
		// Uncategorized comes first
		if ci == "Uncategorized" && cj != "Uncategorized" {
			return true
		}
		if cj == "Uncategorized" && ci != "Uncategorized" {
			return false
		}
		// Then alphabetical by category
		if ci != cj {
			return ci < cj
		}
		// Within same category: order ascending
		if result[i].Order != result[j].Order {
			return result[i].Order < result[j].Order
		}
		// Tiebreaker: timestamp descending (newest first)
		return result[i].Timestamp > result[j].Timestamp
	})

	return result
}

// sliceToMap converts a slice to a map keyed by ID
func sliceToMap(slice []Bookmark) map[string]Bookmark {
	result := make(map[string]Bookmark, len(slice))
	for _, bm := range slice {
		result[bm.ID] = bm
	}
	return result
}

func main() {

	var err error
	if err = godotenv.Load(); err != nil { 
		log.Fatal("Error loading .env file (see env.template): ", err)
	}

	// Load bookmarks on startup
	if err := loadBookmarks(); err != nil {
		log.Printf("Warning: Could not load bookmarks (creating new file on save): %v", err)
	}

	// Routes
	http.HandleFunc("/", handleIndex)                    // The main dashboard
	http.HandleFunc("/api/bookmarks", handleAPI)         // GET (list JSON) & POST (add)
	http.HandleFunc("/api/bookmarks/", handleBookmarkAPI) // DELETE & PATCH /api/bookmarks/:id
	http.HandleFunc("/components.js", handleComponents)  // Serve shared web components
	// TODO use a static folder for these
	http.HandleFunc("/icon.svg", handleIcon)

	port := os.Getenv("BOOKMARKD_PORT");
	host := os.Getenv("BOOKMARKD_HOST");
	fmt.Printf("Bookmarkd server running on http://%s:%s\n", host, port)
	log.Fatal(http.ListenAndServe(host+":"+port, nil))
}

// --- Handlers ---

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, "index.html")
}

func handleComponents(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "extension/components.js")
}

func handleIcon(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "icon.svg")
}

func handleAPI(w http.ResponseWriter, r *http.Request) {
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == "GET" {
		getBookmarksJSON(w)
		return
	}

	if r.Method == "POST" {
		createBookmark(w, r)
		return
	}
}

func handleBookmarkAPI(w http.ResponseWriter, r *http.Request) {
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Extract ID from URL: /api/bookmarks/:id
	id := strings.TrimPrefix(r.URL.Path, "/api/bookmarks/")
	if id == "" {
		http.Error(w, "Missing bookmark ID", http.StatusBadRequest)
		return
	}

	if r.Method == "DELETE" {
		deleteBookmark(w, id)
		return
	}

	if r.Method == "PATCH" {
		updateBookmark(w, r, id)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

// --- Logic ---

func createBookmark(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL      string `json:"url"`
		Title    string `json:"title"`
		Category string `json:"category"`
		Favicon  string `json:"favicon"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	faviconURL := payload.Favicon
	if faviconURL == "" {
		parsedURL, _ := url.Parse(payload.URL)
		domain := ""
		if parsedURL != nil {
			domain = parsedURL.Hostname()
		}
		faviconURL = fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=64", domain)
	}

	// u := uuid.NewSHA1(uuid.NameSpaceURL, []byte(payload.URL))
	// ID:        uuid.New().String(),
	// NOTE: we don't normalize the URL, maybe we should
	category := payload.Category
	if category == "" {
		category = "Uncategorized"
	}

	newBM := Bookmark{
		ID:        uuid.NewSHA1(uuid.NameSpaceURL, []byte(payload.URL)).String(),
		URL:       payload.URL,
		Title:     payload.Title,
		Category:  category,
		Timestamp: time.Now().Unix(),
		Favicon:   faviconURL,
	}

	mu.Lock()
	// Assign order = max order in category + 1
	newBM.Order = maxOrderInCategory(category) + 1
	// Insert into map (O(1) operation, deduplicates automatically)
	bookmarks[newBM.ID] = newBM
	saveBookmarks()
	mu.Unlock()

	w.WriteHeader(http.StatusCreated)
}

// getBookmarksJSON returns bookmarks as JSON for web components
func getBookmarksJSON(w http.ResponseWriter) {
	mu.RLock()
	sortedBookmarks := bookmarksToSortedSlice()
	mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sortedBookmarks)
}

func deleteBookmark(w http.ResponseWriter, id string) {
	mu.Lock()
	defer mu.Unlock()

	if _, exists := bookmarks[id]; !exists {
		http.Error(w, "Bookmark not found", http.StatusNotFound)
		return
	}

	delete(bookmarks, id)
	saveBookmarks()
	w.WriteHeader(http.StatusNoContent)
}

func updateBookmark(w http.ResponseWriter, r *http.Request, id string) {
	var payload struct {
		Title    *string `json:"title"`
		Category *string `json:"category"`
		Order    *int    `json:"order"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	bm, exists := bookmarks[id]
	if !exists {
		http.Error(w, "Bookmark not found", http.StatusNotFound)
		return
	}

	// Update title only if explicitly provided
	if payload.Title != nil {
		bm.Title = *payload.Title
	}

	// Handle category/order change (move operation)
	if payload.Category != nil || payload.Order != nil {
		oldCategory := bm.Category
		oldOrder := bm.Order
		newCategory := oldCategory
		if payload.Category != nil {
			newCategory = *payload.Category
		}
		newOrder := oldOrder
		if payload.Order != nil {
			newOrder = *payload.Order
		}

		if oldCategory == newCategory {
			// Moving within same category
			shiftOrdersInCategory(oldCategory, oldOrder, newOrder, id)
		} else {
			// Moving to different category
			// Close gap in old category
			shiftOrdersAfter(oldCategory, oldOrder, -1, id)
			// Make room in new category
			shiftOrdersFrom(newCategory, newOrder, 1, id)
		}

		bm.Category = newCategory
		bm.Order = newOrder
	}

	bookmarks[id] = bm
	saveBookmarks()

	w.WriteHeader(http.StatusOK)
}

// maxOrderInCategory returns the maximum order value in a category
// Must be called while holding mu.Lock()
func maxOrderInCategory(category string) int {
	maxOrder := -1
	for _, bm := range bookmarks {
		if bm.Category == category && bm.Order > maxOrder {
			maxOrder = bm.Order
		}
	}
	return maxOrder
}

// shiftOrdersInCategory handles reordering within the same category
// Must be called while holding mu.Lock()
func shiftOrdersInCategory(category string, oldOrder, newOrder int, excludeID string) {
	if oldOrder == newOrder {
		return
	}
	for id, bm := range bookmarks {
		if bm.Category != category || id == excludeID {
			continue
		}
		if oldOrder < newOrder {
			// Moving down: shift items in (oldOrder, newOrder] up by -1
			if bm.Order > oldOrder && bm.Order <= newOrder {
				bm.Order--
				bookmarks[id] = bm
			}
		} else {
			// Moving up: shift items in [newOrder, oldOrder) down by +1
			if bm.Order >= newOrder && bm.Order < oldOrder {
				bm.Order++
				bookmarks[id] = bm
			}
		}
	}
}

// shiftOrdersAfter shifts orders > threshold by delta in a category
// Must be called while holding mu.Lock()
func shiftOrdersAfter(category string, threshold, delta int, excludeID string) {
	for id, bm := range bookmarks {
		if bm.Category != category || id == excludeID {
			continue
		}
		if bm.Order > threshold {
			bm.Order += delta
			bookmarks[id] = bm
		}
	}
}

// shiftOrdersFrom shifts orders >= threshold by delta in a category
// Must be called while holding mu.Lock()
func shiftOrdersFrom(category string, threshold, delta int, excludeID string) {
	for id, bm := range bookmarks {
		if bm.Category != category || id == excludeID {
			continue
		}
		if bm.Order >= threshold {
			bm.Order += delta
			bookmarks[id] = bm
		}
	}
}

// --- Persistence ---

func loadBookmarks() error {
	file, err := os.ReadFile(dbFile)
	if err != nil {
		return err
	}

	// Unmarshal into temporary slice (JSON file format)
	var bookmarksSlice []Bookmark
	if err := json.Unmarshal(file, &bookmarksSlice); err != nil {
		return err
	}

	// Convert to map for in-memory storage
	mu.Lock()
	bookmarks = sliceToMap(bookmarksSlice)
	
	// Assign initial orders if bookmarks have Order=0 (migrating old data)
	assignInitialOrders()
	mu.Unlock()

	return nil
}

// assignInitialOrders assigns order values to bookmarks that have Order=0
// Groups by category, sorts by timestamp desc, assigns 0,1,2...
// Must be called while holding mu.Lock()
func assignInitialOrders() {
	// Check if any bookmark has non-zero order (already migrated)
	for _, bm := range bookmarks {
		if bm.Order != 0 {
			return
		}
	}
	
	if len(bookmarks) == 0 {
		return
	}

	// Group by category
	byCategory := make(map[string][]Bookmark)
	for _, bm := range bookmarks {
		byCategory[bm.Category] = append(byCategory[bm.Category], bm)
	}

	// Sort each category by timestamp desc and assign orders
	for cat, bms := range byCategory {
		sort.Slice(bms, func(i, j int) bool {
			return bms[i].Timestamp > bms[j].Timestamp
		})
		for i, bm := range bms {
			bm.Order = i
			bookmarks[bm.ID] = bm
		}
		_ = cat // unused
	}
}

func saveBookmarks() error {
	// Convert map to sorted slice for persistence
	bookmarksSlice := bookmarksToSortedSlice()

	data, err := json.MarshalIndent(bookmarksSlice, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dbFile, data, 0644)
}
