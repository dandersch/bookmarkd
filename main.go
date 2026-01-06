package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	// "sort"
	"sync"
	"time"

	"github.com/joho/godotenv" // loading envars from .env
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
	bookmarks []Bookmark
	mu        sync.RWMutex // Protects the bookmarks slice during concurrent writes
)

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
	http.HandleFunc("/api/bookmarks", handleAPI)     // GET (list fragments) & POST (add)

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
	
	mu.RLock()
	defer mu.RUnlock()

	tmpl, err := template.ParseFiles("index.html")
	if err != nil {
		http.Error(w, "Could not load template", http.StatusInternalServerError)
		return
	}
	
	// Pass the bookmarks to the template
	tmpl.Execute(w, bookmarks)
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
		renderBookmarksFragment(w)
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

	newBM := Bookmark{
		ID:        uuid.New().String(),
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
	// Prepend to list (newest first)
	bookmarks = append([]Bookmark{newBM}, bookmarks...)
	saveBookmarks()
	mu.Unlock()

	w.WriteHeader(http.StatusCreated)
}

// renderBookmarksFragment returns purely HTML <li> items for the extension
func renderBookmarksFragment(w http.ResponseWriter) {
	mu.RLock()
	defer mu.RUnlock()

	// Simple HTML template inline for the fragment
	const tpl = `
	{{range .}}
    <li class="list-row p-2 hover:bg-blue-500">
      <img src="{{.Favicon}}" class="size-5" alt="icon">
      <a href="{{.URL}}" target="_blank" class="text-sm block truncate">{{.Title}}</a>
      <span class="badge bg-gray-600 badge-xs mt-1">{{.Category}}</span>
	</li>
	{{end}}`

	t, _ := template.New("fragment").Parse(tpl)
	t.Execute(w, bookmarks)
}

// --- Persistence ---

func loadBookmarks() error {
	file, err := os.ReadFile(dbFile)
	if err != nil {
		return err
	}
	return json.Unmarshal(file, &bookmarks)
}

func saveBookmarks() error {
	data, err := json.MarshalIndent(bookmarks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dbFile, data, 0644)
}
