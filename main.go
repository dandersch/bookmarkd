package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
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
}

const dbFile = "bookmarks.json"

var (
	bookmarks map[string]Bookmark
	mu        sync.RWMutex // Protects the bookmarks map during concurrent reads/writes
)

// bookmarksToSortedSlice converts the map to a slice sorted by timestamp (newest first)
// Must be called while holding mu.RLock()
func bookmarksToSortedSlice() []Bookmark {
	if len(bookmarks) == 0 {
		return []Bookmark{}
	}

	result := make([]Bookmark, 0, len(bookmarks))
	for _, bm := range bookmarks {
		result = append(result, bm)
	}

	// Sort by timestamp descending (newest first)
	sort.Slice(result, func(i, j int) bool {
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
	http.HandleFunc("/", handleIndex)                // The main dashboard
	http.HandleFunc("/api/bookmarks", handleAPI)     // GET (list JSON) & POST (add)
	http.HandleFunc("/components.js", handleComponents) // Serve shared web components

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

func handleAPI(w http.ResponseWriter, r *http.Request) {
	// CORS Headers (Essential for Extension access)
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

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

// --- Logic ---

func createBookmark(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL      string `json:"url"`
		Title    string `json:"title"`
		Category string `json:"category"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Determine Favicon URL
	parsedURL, _ := url.Parse(payload.URL)
	domain := ""
	if parsedURL != nil {
		domain = parsedURL.Hostname()
	}
	faviconURL := fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s", domain)

	// u := uuid.NewSHA1(uuid.NameSpaceURL, []byte(payload.URL))
	// ID:        uuid.New().String(),
	// NOTE: we don't normalize the URL, maybe we should
	newBM := Bookmark{
		ID:        uuid.NewSHA1(uuid.NameSpaceURL, []byte(payload.URL)).String(),
		URL:       payload.URL,
		Title:     payload.Title,
		Category:  payload.Category,
		Timestamp: time.Now().Unix(),
		Favicon:   faviconURL,
	}
	if newBM.Category == "" {
		newBM.Category = "Uncategorized"
	}

	mu.Lock()
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
	mu.Unlock()

	return nil
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
