package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
)

// Data Models
type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Order int    `json:"order"`
	Color string `json:"color,omitempty"`
}

type Bookmark struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Category    string `json:"category"`
	CategoryID  string `json:"category_id"`
	Timestamp   int64  `json:"timestamp"`
	Favicon     string `json:"favicon"`
	Order       int    `json:"order"`
	LastVisited *int64 `json:"last_visited,omitempty"`
	Notes       string `json:"notes,omitempty"`
	Watched       bool   `json:"watched,omitempty"`
	WatchInterval int    `json:"watch_interval,omitempty"`
	ContentHash string `json:"content_hash,omitempty"`
	LastChecked *int64 `json:"last_checked,omitempty"`
	Changed     bool   `json:"changed,omitempty"`
	ChangedAt   *int64 `json:"changed_at,omitempty"`
	TrackTime   bool   `json:"track_time,omitempty"`
}

type Database struct {
	Categories []Category `json:"categories"`
	Bookmarks  []Bookmark `json:"bookmarks"`
}

type CustomTheme struct {
	Name string
	CSS  string
}

type TimeEntry struct {
	Timestamp int64 `json:"timestamp"`
	Seconds   int   `json:"seconds"`
}

type DomainTimeData struct {
	Entries []TimeEntry `json:"entries"`
}

const dbFile = "bookmarks.json"
const timeTrackingFile = "time_tracking.json"
const uncategorizedID = "uncategorized"

var (
	categories   map[string]Category
	bookmarks    map[string]Bookmark
	customThemes []CustomTheme
	timeTracking map[string]*DomainTimeData
	mu           sync.RWMutex
	timeMu       sync.RWMutex
	themeMu      sync.RWMutex
	tmpl         *template.Template
)

func getCategoryName(categoryID string) string {
	if cat, ok := categories[categoryID]; ok {
		return cat.Name
	}
	return "Uncategorized"
}

func getCategoryByName(name string) *Category {
	for _, cat := range categories {
		if cat.Name == name {
			return &cat
		}
	}
	return nil
}

// resolveOrCreateCategory returns the category ID for the given name,
// creating a new category if one doesn't already exist.
// Must be called with mu held.
func resolveOrCreateCategory(name string) string {
	if name == "" || name == "Uncategorized" {
		return uncategorizedID
	}
	if existing := getCategoryByName(name); existing != nil {
		return existing.ID
	}
	maxOrder := 0
	for _, cat := range categories {
		if cat.Order > maxOrder {
			maxOrder = cat.Order
		}
	}
	newCat := Category{
		ID:    uuid.New().String(),
		Name:  name,
		Order: maxOrder + 1,
	}
	categories[newCat.ID] = newCat
	return newCat.ID
}

func bookmarksToSortedSlice() []Bookmark {
	if len(bookmarks) == 0 {
		return []Bookmark{}
	}

	result := make([]Bookmark, 0, len(bookmarks))
	for _, bm := range bookmarks {
		result = append(result, bm)
	}

	sort.Slice(result, func(i, j int) bool {
		catI := categories[result[i].CategoryID]
		catJ := categories[result[j].CategoryID]

		if catI.ID == uncategorizedID && catJ.ID != uncategorizedID {
			return true
		}
		if catJ.ID == uncategorizedID && catI.ID != uncategorizedID {
			return false
		}

		if catI.Order != catJ.Order {
			return catI.Order < catJ.Order
		}

		if result[i].Order != result[j].Order {
			return result[i].Order < result[j].Order
		}

		return result[i].Timestamp > result[j].Timestamp
	})

	return result
}

func categoriesToSortedSlice() []Category {
	if len(categories) == 0 {
		return []Category{}
	}

	result := make([]Category, 0, len(categories))
	for _, cat := range categories {
		result = append(result, cat)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].ID == uncategorizedID {
			return true
		}
		if result[j].ID == uncategorizedID {
			return false
		}
		return result[i].Order < result[j].Order
	})

	return result
}

func sliceToBookmarkMap(slice []Bookmark) map[string]Bookmark {
	result := make(map[string]Bookmark, len(slice))
	for _, bm := range slice {
		result[bm.ID] = bm
	}
	return result
}

func sliceToCategoryMap(slice []Category) map[string]Category {
	result := make(map[string]Category, len(slice))
	for _, cat := range slice {
		result[cat.ID] = cat
	}
	return result
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("No .env file found, using environment variables")
	}

	if err := loadDatabase(); err != nil {
		log.Printf("Warning: Could not load bookmarks (creating new file on save): %v", err)
		initializeDefaults()
	}

	loadTimeTracking()

	tmpl = template.Must(template.ParseFiles("index.html"))

	loadThemes()

	startWatcher()

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/bookmarks", withCORS(handleAPI))
	http.HandleFunc("/api/bookmarks/", withCORS(handleBookmarkAPI))
	http.HandleFunc("/api/categories", withCORS(handleCategoriesAPI))
	http.HandleFunc("/api/categories/reorder", withCORS(handleCategoriesReorder))
	http.HandleFunc("/api/categories/", withCORS(handleCategoryAPI))
	http.HandleFunc("/api/themes", withCORS(handleThemesAPI))
	http.HandleFunc("/api/watch/check", withCORS(handleWatchCheck))
	http.HandleFunc("/api/time-tracking/", withCORS(handleTimeTrackingAPI))

	http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	port := os.Getenv("BOOKMARKD_PORT")
	host := os.Getenv("BOOKMARKD_HOST")
	fmt.Printf("Bookmarkd server running on http://%s:%s\n", host, port)
	log.Fatal(http.ListenAndServe(host+":"+port, nil))
}

func initializeDefaults() {
	mu.Lock()
	defer mu.Unlock()
	categories = make(map[string]Category)
	bookmarks = make(map[string]Bookmark)
	categories[uncategorizedID] = Category{
		ID:    uncategorizedID,
		Name:  "Uncategorized",
		Order: 0,
	}
}

// --- Handlers ---

func handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	themeMu.RLock()
	themes := customThemes
	themeMu.RUnlock()

	var themeCSS strings.Builder
	for _, t := range themes {
		themeCSS.WriteString(t.CSS)
		themeCSS.WriteString("\n")
	}

	data := struct {
		CustomThemes    []CustomTheme
		CustomThemeCSS  template.CSS
	}{
		CustomThemes:   themes,
		CustomThemeCSS: template.CSS(themeCSS.String()),
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		log.Printf("Template execute error: %v", err)
	}
}





func handleAPI(w http.ResponseWriter, r *http.Request) {
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
	path := strings.TrimPrefix(r.URL.Path, "/api/bookmarks/")
	if path == "" {
		http.Error(w, "Missing bookmark ID", http.StatusBadRequest)
		return
	}

	// Handle /api/bookmarks/:id/visit
	if strings.HasSuffix(path, "/visit") {
		id := strings.TrimSuffix(path, "/visit")
		if r.Method == "POST" {
			visitBookmark(w, id)
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := path

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

func handleCategoriesAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		getCategoriesJSON(w)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// handleCategoriesReorder handles batch reordering of categories.
// NOTE: For high-frequency reordering or collaborative scenarios, consider
// switching to lexical ranking (e.g., fractional-indexing) which only requires
// updating the moved item's order string, eliminating batch updates entirely.
func handleCategoriesReorder(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		Order []string `json:"order"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if len(payload.Order) == 0 {
		http.Error(w, "Order array is required", http.StatusBadRequest)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	for i, id := range payload.Order {
		if cat, exists := categories[id]; exists {
			cat.Order = i
			categories[id] = cat
		}
	}

	saveDatabase()
	w.WriteHeader(http.StatusOK)
}

func handleCategoryAPI(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/categories/")
	if name == "" {
		http.Error(w, "Missing category name", http.StatusBadRequest)
		return
	}

	decodedName, err := url.PathUnescape(name)
	if err != nil {
		http.Error(w, "Invalid category name", http.StatusBadRequest)
		return
	}

	if r.Method == "POST" {
		createCategory(w, r, decodedName)
		return
	}

	if r.Method == "PUT" {
		updateCategory(w, r, decodedName)
		return
	}

	if r.Method == "DELETE" {
		deleteCategory(w, decodedName)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setCORSHeaders(w)
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

// --- Category Logic ---

func getCategoriesJSON(w http.ResponseWriter) {
	mu.RLock()
	sortedCategories := categoriesToSortedSlice()
	mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sortedCategories)
}

func createCategory(w http.ResponseWriter, r *http.Request, name string) {
	if name == "" {
		http.Error(w, "Category name is required", http.StatusBadRequest)
		return
	}

	var payload struct {
		Color string `json:"color"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	mu.Lock()
	defer mu.Unlock()

	if existing := getCategoryByName(name); existing != nil {
		http.Error(w, "Category already exists", http.StatusConflict)
		return
	}

	maxOrder := 0
	for _, cat := range categories {
		if cat.Order > maxOrder {
			maxOrder = cat.Order
		}
	}

	newCat := Category{
		ID:    uuid.New().String(),
		Name:  name,
		Order: maxOrder + 1,
		Color: payload.Color,
	}
	categories[newCat.ID] = newCat
	saveDatabase()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newCat)
}

func updateCategory(w http.ResponseWriter, r *http.Request, oldName string) {
	var payload struct {
		Name  *string `json:"name"`
		Order *int    `json:"order"`
		Color *string `json:"color"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	cat := getCategoryByName(oldName)
	if cat == nil {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}

	if cat.ID == uncategorizedID && payload.Name != nil && *payload.Name != "Uncategorized" {
		http.Error(w, "Cannot rename Uncategorized category", http.StatusForbidden)
		return
	}

	if payload.Name != nil && *payload.Name != cat.Name {
		if existing := getCategoryByName(*payload.Name); existing != nil {
			http.Error(w, "Category name already exists", http.StatusConflict)
			return
		}
		cat.Name = *payload.Name
	}

	if payload.Order != nil {
		cat.Order = *payload.Order
	}

	if payload.Color != nil {
		cat.Color = *payload.Color
	}

	categories[cat.ID] = *cat
	saveDatabase()

	w.WriteHeader(http.StatusOK)
}

// deleteCategory removes a category and all its bookmarks.
// The frontend shows a confirmation dialog warning users about bookmark deletion.
func deleteCategory(w http.ResponseWriter, name string) {
	mu.Lock()
	defer mu.Unlock()

	cat := getCategoryByName(name)
	if cat == nil {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}

	if cat.ID == uncategorizedID {
		http.Error(w, "Cannot delete Uncategorized category", http.StatusForbidden)
		return
	}

	for id, bm := range bookmarks {
		if bm.CategoryID == cat.ID {
			delete(bookmarks, id)
		}
	}

	delete(categories, cat.ID)
	saveDatabase()

	w.WriteHeader(http.StatusNoContent)
}

// --- Favicon Logic ---

var faviconLinkRe = regexp.MustCompile(`(?i)<link\s[^>]*?>`)
var faviconAttrRe = regexp.MustCompile(`(?i)(\w+)\s*=\s*"([^"]*)"`)

func fetchBestFavicon(pageURL string) string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(pageURL)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return ""
	}

	head := string(body)
	if idx := strings.Index(strings.ToLower(head), "</head>"); idx != -1 {
		head = head[:idx]
	}

	type iconCandidate struct {
		href string
		size int
	}

	var candidates []iconCandidate
	for _, match := range faviconLinkRe.FindAllString(head, -1) {
		attrs := map[string]string{}
		for _, a := range faviconAttrRe.FindAllStringSubmatch(match, -1) {
			attrs[strings.ToLower(a[1])] = a[2]
		}

		rel := strings.ToLower(attrs["rel"])
		if rel != "icon" && rel != "shortcut icon" && rel != "apple-touch-icon" && rel != "apple-touch-icon-precomposed" {
			continue
		}

		href := attrs["href"]
		if href == "" {
			continue
		}

		size := 0
		if rel == "apple-touch-icon" || rel == "apple-touch-icon-precomposed" {
			size = 180 // assume large if no sizes specified
		}
		if s := attrs["sizes"]; s != "" {
			parts := strings.SplitN(strings.ToLower(s), "x", 2)
			if len(parts) == 2 {
				if n, err := strconv.Atoi(parts[0]); err == nil {
					size = n
				}
			}
		}

		candidates = append(candidates, iconCandidate{href: href, size: size})
	}

	if len(candidates) == 0 {
		return ""
	}

	// pick the largest
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.size > best.size {
			best = c
		}
	}

	// resolve relative URLs
	href := best.href
	if !strings.HasPrefix(href, "http://") && !strings.HasPrefix(href, "https://") {
		base, err := url.Parse(pageURL)
		if err != nil {
			return href
		}
		ref, err := url.Parse(href)
		if err != nil {
			return href
		}
		href = base.ResolveReference(ref).String()
	}

	return href
}

// --- Bookmark Logic ---

func createBookmark(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL        string `json:"url"`
		Title      string `json:"title"`
		Category   string `json:"category"`
		CategoryID string `json:"category_id"`
		Favicon    string `json:"favicon"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	faviconURL := fetchBestFavicon(payload.URL)
	if faviconURL == "" {
		faviconURL = payload.Favicon
	}

	mu.Lock()
	defer mu.Unlock()

	categoryID := payload.CategoryID
	if categoryID == "" {
		categoryID = resolveOrCreateCategory(payload.Category)
	}

	newBM := Bookmark{
		ID:         uuid.NewSHA1(uuid.NameSpaceURL, []byte(payload.URL)).String(),
		URL:        payload.URL,
		Title:      payload.Title,
		CategoryID: categoryID,
		Timestamp:  time.Now().Unix(),
		Favicon:    faviconURL,
		Order:      maxOrderInCategory(categoryID) + 1,
	}

	bookmarks[newBM.ID] = newBM
	saveDatabase()

	w.WriteHeader(http.StatusCreated)
}

func getBookmarksJSON(w http.ResponseWriter) {
	mu.RLock()
	sortedBookmarks := bookmarksToSortedSlice()
	for i := range sortedBookmarks {
		sortedBookmarks[i].Category = getCategoryName(sortedBookmarks[i].CategoryID)
	}
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
	saveDatabase()
	w.WriteHeader(http.StatusNoContent)
}

func visitBookmark(w http.ResponseWriter, id string) {
	mu.Lock()
	defer mu.Unlock()

	bm, exists := bookmarks[id]
	if !exists {
		http.Error(w, "Bookmark not found", http.StatusNotFound)
		return
	}

	now := time.Now().Unix()
	bm.LastVisited = &now
	bm.Changed = false
	bm.ChangedAt = nil
	bookmarks[id] = bm
	saveDatabase()
	w.WriteHeader(http.StatusNoContent)
}

func updateBookmark(w http.ResponseWriter, r *http.Request, id string) {
	var payload struct {
		Title      *string `json:"title"`
		URL        *string `json:"url"`
		Category   *string `json:"category"`
		CategoryID *string `json:"category_id"`
		Order      *int    `json:"order"`
		Notes      *string `json:"notes"`
		Watched       *bool   `json:"watched"`
		WatchInterval *int    `json:"watch_interval"`
		Changed       *bool   `json:"changed"`
		TrackTime     *bool   `json:"track_time"`
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

	if payload.Title != nil {
		bm.Title = *payload.Title
	}

	if payload.URL != nil {
		bm.URL = *payload.URL
	}

	if payload.Notes != nil {
		notes := *payload.Notes
		if len(notes) > 1000 {
			notes = notes[:1000]
		}
		bm.Notes = notes
	}

	if payload.Watched != nil {
		bm.Watched = *payload.Watched
		if *payload.Watched && bm.ContentHash == "" {
			go fetchAndStoreInitialHash(id)
		}
	}

	if payload.WatchInterval != nil {
		interval := *payload.WatchInterval
		if interval < 30 {
			interval = 30
		}
		bm.WatchInterval = interval
	}

	if payload.Changed != nil {
		bm.Changed = *payload.Changed
		if !*payload.Changed {
			bm.ChangedAt = nil
		}
	}

	if payload.TrackTime != nil {
		bm.TrackTime = *payload.TrackTime
	}

	newCategoryID := bm.CategoryID
	if payload.CategoryID != nil {
		newCategoryID = *payload.CategoryID
	} else if payload.Category != nil {
		newCategoryID = resolveOrCreateCategory(*payload.Category)
	}

	if payload.CategoryID != nil || payload.Category != nil || payload.Order != nil {
		oldCategoryID := bm.CategoryID
		oldOrder := bm.Order
		newOrder := oldOrder
		if payload.Order != nil {
			newOrder = *payload.Order
		}

		if oldCategoryID == newCategoryID {
			shiftOrdersInCategory(oldCategoryID, oldOrder, newOrder, id)
		} else {
			shiftOrdersAfter(oldCategoryID, oldOrder, -1, id)
			shiftOrdersFrom(newCategoryID, newOrder, 1, id)
		}

		bm.CategoryID = newCategoryID
		bm.Order = newOrder
	}

	bookmarks[id] = bm
	saveDatabase()

	w.WriteHeader(http.StatusOK)
}

func maxOrderInCategory(categoryID string) int {
	maxOrder := -1
	for _, bm := range bookmarks {
		if bm.CategoryID == categoryID && bm.Order > maxOrder {
			maxOrder = bm.Order
		}
	}
	return maxOrder
}

func shiftOrdersInCategory(categoryID string, oldOrder, newOrder int, excludeID string) {
	if oldOrder == newOrder {
		return
	}
	for id, bm := range bookmarks {
		if bm.CategoryID != categoryID || id == excludeID {
			continue
		}
		if oldOrder < newOrder {
			if bm.Order > oldOrder && bm.Order <= newOrder {
				bm.Order--
				bookmarks[id] = bm
			}
		} else {
			if bm.Order >= newOrder && bm.Order < oldOrder {
				bm.Order++
				bookmarks[id] = bm
			}
		}
	}
}

func shiftOrdersAfter(categoryID string, threshold, delta int, excludeID string) {
	for id, bm := range bookmarks {
		if bm.CategoryID != categoryID || id == excludeID {
			continue
		}
		if bm.Order > threshold {
			bm.Order += delta
			bookmarks[id] = bm
		}
	}
}

func shiftOrdersFrom(categoryID string, threshold, delta int, excludeID string) {
	for id, bm := range bookmarks {
		if bm.CategoryID != categoryID || id == excludeID {
			continue
		}
		if bm.Order >= threshold {
			bm.Order += delta
			bookmarks[id] = bm
		}
	}
}

// --- Watch ---

func fetchAndStoreInitialHash(bookmarkID string) {
	mu.RLock()
	bm, exists := bookmarks[bookmarkID]
	mu.RUnlock()
	if !exists {
		return
	}

	hash, err := fetchPageHash(bm.URL)
	if err != nil {
		log.Printf("Watch: failed to fetch initial hash for %s: %v", bm.URL, err)
		return
	}

	mu.Lock()
	defer mu.Unlock()
	bm, exists = bookmarks[bookmarkID]
	if !exists {
		return
	}
	now := time.Now().Unix()
	bm.ContentHash = hash
	bm.LastChecked = &now
	bookmarks[bookmarkID] = bm
	saveDatabase()
}

func fetchPageHash(pageURL string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Bookmarkd/1.0)")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, resp.Body); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hasher.Sum(nil)), nil
}

func handleWatchCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	go checkWatchedBookmarks(true)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "check started"})
}

func startWatcher() {
	go func() {
		for {
			time.Sleep(15 * time.Minute)
			checkWatchedBookmarks(false)
		}
	}()
}

func checkWatchedBookmarks(force bool) {
	mu.RLock()
	var watched []Bookmark
	now := time.Now().Unix()
	for _, bm := range bookmarks {
		if !bm.Watched {
			continue
		}
		if !force {
			interval := bm.WatchInterval
			if interval <= 0 {
				interval = 360 // default 6 hours
			}
			intervalSec := int64(interval) * 60
			if bm.LastChecked != nil && (now - *bm.LastChecked) < intervalSec {
				continue
			}
		}
		watched = append(watched, bm)
	}
	mu.RUnlock()

	log.Printf("Watch: starting check for %d watched bookmarks", len(watched))

	changed := 0
	for _, bm := range watched {
		hash, err := fetchPageHash(bm.URL)
		if err != nil {
			log.Printf("Watch: failed to check %s: %v", bm.URL, err)
			continue
		}

		mu.Lock()
		current, exists := bookmarks[bm.ID]
		if exists && current.Watched {
			now := time.Now().Unix()
			current.LastChecked = &now
			if current.ContentHash != "" && current.ContentHash != hash {
				current.Changed = true
				changedAt := time.Now().Unix()
				current.ChangedAt = &changedAt
				changed++
				log.Printf("Watch: change detected on %s", current.URL)
			}
			current.ContentHash = hash
			bookmarks[bm.ID] = current
		}
		mu.Unlock()
	}

	mu.Lock()
	saveDatabase()
	mu.Unlock()

	log.Printf("Watch: check complete, %d/%d bookmarks changed", changed, len(watched))
}

// --- Persistence ---

func loadDatabase() error {
	file, err := os.ReadFile(dbFile)
	if err != nil {
		return err
	}

	var rawData json.RawMessage
	if err := json.Unmarshal(file, &rawData); err != nil {
		return err
	}

	var db Database
	if err := json.Unmarshal(rawData, &db); err == nil && db.Categories != nil {
		mu.Lock()
		categories = sliceToCategoryMap(db.Categories)
		bookmarks = sliceToBookmarkMap(db.Bookmarks)

		if _, exists := categories[uncategorizedID]; !exists {
			categories[uncategorizedID] = Category{
				ID:    uncategorizedID,
				Name:  "Uncategorized",
				Order: 0,
			}
		}
		mu.Unlock()
		return nil
	}

	var oldBookmarks []struct {
		ID        string `json:"id"`
		URL       string `json:"url"`
		Title     string `json:"title"`
		Category  string `json:"category"`
		Timestamp int64  `json:"timestamp"`
		Favicon   string `json:"favicon"`
		Order     int    `json:"order"`
	}
	if err := json.Unmarshal(rawData, &oldBookmarks); err != nil {
		return err
	}

	mu.Lock()
	defer mu.Unlock()

	categories = make(map[string]Category)
	bookmarks = make(map[string]Bookmark)

	categories[uncategorizedID] = Category{
		ID:    uncategorizedID,
		Name:  "Uncategorized",
		Order: 0,
	}

	categoryNames := make(map[string]string)
	categoryOrder := 1
	for _, oldBM := range oldBookmarks {
		catName := oldBM.Category
		if catName == "" {
			catName = "Uncategorized"
		}

		var categoryID string
		if catName == "Uncategorized" {
			categoryID = uncategorizedID
		} else if existingID, ok := categoryNames[catName]; ok {
			categoryID = existingID
		} else {
			categoryID = uuid.New().String()
			categories[categoryID] = Category{
				ID:    categoryID,
				Name:  catName,
				Order: categoryOrder,
			}
			categoryNames[catName] = categoryID
			categoryOrder++
		}

		bookmarks[oldBM.ID] = Bookmark{
			ID:         oldBM.ID,
			URL:        oldBM.URL,
			Title:      oldBM.Title,
			CategoryID: categoryID,
			Timestamp:  oldBM.Timestamp,
			Favicon:    oldBM.Favicon,
			Order:      oldBM.Order,
		}
	}

	saveDatabase()
	return nil
}

func saveDatabase() {
	db := Database{
		Categories: categoriesToSortedSlice(),
		Bookmarks:  bookmarksToSortedSlice(),
	}

	data, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		log.Printf("Error marshaling database: %v", err)
		return
	}
	if err := os.WriteFile(dbFile, data, 0644); err != nil {
		log.Printf("Error saving database: %v", err)
	}
}

// --- Time Tracking ---

func loadTimeTracking() {
	file, err := os.ReadFile(timeTrackingFile)
	if err != nil {
		if os.IsNotExist(err) {
			timeTracking = make(map[string]*DomainTimeData)
			return
		}
		log.Printf("Warning: Could not load time tracking: %v", err)
		timeTracking = make(map[string]*DomainTimeData)
		return
	}

	timeMu.Lock()
	defer timeMu.Unlock()

	if err := json.Unmarshal(file, &timeTracking); err != nil {
		log.Printf("Warning: Could not parse time tracking: %v", err)
		timeTracking = make(map[string]*DomainTimeData)
		return
	}

	if timeTracking == nil {
		timeTracking = make(map[string]*DomainTimeData)
	}
}

func saveTimeTracking() {
	data, err := json.MarshalIndent(timeTracking, "", "  ")
	if err != nil {
		log.Printf("Error marshaling time tracking: %v", err)
		return
	}
	if err := os.WriteFile(timeTrackingFile, data, 0644); err != nil {
		log.Printf("Error saving time tracking: %v", err)
	}
}

func normalizeDomain(domain string) string {
	return strings.TrimPrefix(domain, "www.")
}

func handleTimeTrackingAPI(w http.ResponseWriter, r *http.Request) {
	domain := normalizeDomain(strings.TrimPrefix(r.URL.Path, "/api/time-tracking/"))
	if domain == "" {
		http.Error(w, "Missing domain", http.StatusBadRequest)
		return
	}

	if r.Method == "GET" {
		getTimeTracking(w, domain)
		return
	}

	if r.Method == "POST" {
		postTimeTracking(w, r, domain)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func getTimeTracking(w http.ResponseWriter, domain string) {
	timeMu.RLock()
	data, exists := timeTracking[domain]
	timeMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	if !exists {
		json.NewEncoder(w).Encode(DomainTimeData{Entries: []TimeEntry{}})
		return
	}
	json.NewEncoder(w).Encode(data)
}

func postTimeTracking(w http.ResponseWriter, r *http.Request, domain string) {
	var payload struct {
		Timestamp int64 `json:"timestamp"`
		Seconds   int   `json:"seconds"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if payload.Seconds <= 0 {
		http.Error(w, "Seconds must be positive", http.StatusBadRequest)
		return
	}

	timeMu.Lock()
	defer timeMu.Unlock()

	if timeTracking[domain] == nil {
		timeTracking[domain] = &DomainTimeData{Entries: []TimeEntry{}}
	}

	timeTracking[domain].Entries = append(timeTracking[domain].Entries, TimeEntry{
		Timestamp: payload.Timestamp,
		Seconds:   payload.Seconds,
	})

	saveTimeTracking()
	w.WriteHeader(http.StatusNoContent)
}

// --- Theme Management ---

func getThemesDir() string {
	dir := os.Getenv("BOOKMARKD_THEMES")
	if dir == "" {
		dir = "themes"
	}
	return dir
}

func loadThemes() {
	themeMu.Lock()
	defer themeMu.Unlock()

	customThemes = nil
	themesDir := getThemesDir()

	files, err := os.ReadDir(themesDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: Could not read themes directory: %v", err)
		}
		return
	}

	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".css") {
			continue
		}

		content, err := os.ReadFile(filepath.Join(themesDir, file.Name()))
		if err != nil {
			log.Printf("Warning: Could not read theme file %s: %v", file.Name(), err)
			continue
		}

		theme := parseThemeCSS(string(content))
		if theme != nil {
			customThemes = append(customThemes, *theme)
			log.Printf("Loaded custom theme: %s", theme.Name)
		}
	}
}

func parseThemeCSS(cssText string) *CustomTheme {
	nameRe := regexp.MustCompile(`name:\s*["']([^"']+)["']`)
	nameMatch := nameRe.FindStringSubmatch(cssText)
	if nameMatch == nil {
		return nil
	}
	themeName := nameMatch[1]

	var varLines []string

	colorSchemeRe := regexp.MustCompile(`color-scheme:\s*["']([^"']+)["']`)
	if match := colorSchemeRe.FindStringSubmatch(cssText); match != nil {
		varLines = append(varLines, fmt.Sprintf("color-scheme: %s;", match[1]))
	}

	varRe := regexp.MustCompile(`(--[\w-]+):\s*([^;]+);`)
	for _, match := range varRe.FindAllStringSubmatch(cssText, -1) {
		varLines = append(varLines, fmt.Sprintf("%s: %s;", match[1], match[2]))
	}

	if len(varLines) == 0 {
		return nil
	}

	css := fmt.Sprintf("[data-theme=\"%s\"] {\n  %s\n}", themeName, strings.Join(varLines, "\n  "))
	return &CustomTheme{Name: themeName, CSS: css}
}

func handleThemesAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		themeMu.RLock()
		themes := make([]map[string]string, len(customThemes))
		for i, t := range customThemes {
			themes[i] = map[string]string{"name": t.Name}
		}
		themeMu.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(themes)
		return
	}

	if r.Method == "POST" {
		var payload struct {
			CSS string `json:"css"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		theme := parseThemeCSS(payload.CSS)
		if theme == nil {
			http.Error(w, "Invalid theme CSS: could not parse name or variables", http.StatusBadRequest)
			return
		}

		themesDir := getThemesDir()
		if err := os.MkdirAll(themesDir, 0755); err != nil {
			http.Error(w, "Could not create themes directory", http.StatusInternalServerError)
			return
		}

		filename := filepath.Join(themesDir, theme.Name+".css")
		if err := os.WriteFile(filename, []byte(payload.CSS), 0644); err != nil {
			http.Error(w, "Could not save theme file", http.StatusInternalServerError)
			return
		}

		loadThemes()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"name": theme.Name})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}
