package main

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
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
}

type Database struct {
	Categories []Category `json:"categories"`
	Bookmarks  []Bookmark `json:"bookmarks"`
}

type CustomTheme struct {
	Name string
	CSS  string
}

const dbFile = "bookmarks.json"
const uncategorizedID = "uncategorized"

var (
	categories   map[string]Category
	bookmarks    map[string]Bookmark
	customThemes []CustomTheme
	mu           sync.RWMutex
	themeMu      sync.RWMutex
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

	loadThemes()

	http.HandleFunc("/", handleIndex)
	http.HandleFunc("/api/bookmarks", handleAPI)
	http.HandleFunc("/api/bookmarks/", handleBookmarkAPI)
	http.HandleFunc("/api/categories", handleCategoriesAPI)
	http.HandleFunc("/api/categories/reorder", handleCategoriesReorder)
	http.HandleFunc("/api/categories/", handleCategoryAPI)
	http.HandleFunc("/api/themes", handleThemesAPI)

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

	tmpl, err := template.ParseFiles("index.html")
	if err != nil {
		http.Error(w, "Template error", http.StatusInternalServerError)
		log.Printf("Template parse error: %v", err)
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
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

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
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

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
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

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

	var cat *Category
	for _, c := range categories {
		if c.Name == oldName {
			cat = &c
			break
		}
	}
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

func deleteCategory(w http.ResponseWriter, name string) {
	mu.Lock()
	defer mu.Unlock()

	var cat *Category
	for _, c := range categories {
		if c.Name == name {
			cat = &c
			break
		}
	}
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
			bm.CategoryID = uncategorizedID
			bm.Order = maxOrderInCategory(uncategorizedID) + 1
			bookmarks[id] = bm
		}
	}

	delete(categories, cat.ID)
	saveDatabase()

	w.WriteHeader(http.StatusNoContent)
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

	faviconURL := payload.Favicon
	if faviconURL == "" {
		parsedURL, _ := url.Parse(payload.URL)
		domain := ""
		if parsedURL != nil {
			domain = parsedURL.Hostname()
		}
		faviconURL = fmt.Sprintf("https://www.google.com/s2/favicons?domain=%s&sz=64", domain)
	}

	mu.Lock()
	defer mu.Unlock()

	categoryID := payload.CategoryID
	if categoryID == "" {
		if payload.Category != "" && payload.Category != "Uncategorized" {
			if existing := getCategoryByName(payload.Category); existing != nil {
				categoryID = existing.ID
			} else {
				maxOrder := 0
				for _, cat := range categories {
					if cat.Order > maxOrder {
						maxOrder = cat.Order
					}
				}
				newCat := Category{
					ID:    uuid.New().String(),
					Name:  payload.Category,
					Order: maxOrder + 1,
				}
				categories[newCat.ID] = newCat
				categoryID = newCat.ID
			}
		} else {
			categoryID = uncategorizedID
		}
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
	bookmarks[id] = bm
	saveDatabase()
	w.WriteHeader(http.StatusNoContent)
}

func updateBookmark(w http.ResponseWriter, r *http.Request, id string) {
	var payload struct {
		Title      *string `json:"title"`
		Category   *string `json:"category"`
		CategoryID *string `json:"category_id"`
		Order      *int    `json:"order"`
		Notes      *string `json:"notes"`
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

	if payload.Notes != nil {
		notes := *payload.Notes
		if len(notes) > 1000 {
			notes = notes[:1000]
		}
		bm.Notes = notes
	}

	newCategoryID := bm.CategoryID
	if payload.CategoryID != nil {
		newCategoryID = *payload.CategoryID
	} else if payload.Category != nil {
		if existing := getCategoryByName(*payload.Category); existing != nil {
			newCategoryID = existing.ID
		} else if *payload.Category != "" {
			maxOrder := 0
			for _, cat := range categories {
				if cat.Order > maxOrder {
					maxOrder = cat.Order
				}
			}
			newCat := Category{
				ID:    uuid.New().String(),
				Name:  *payload.Category,
				Order: maxOrder + 1,
			}
			categories[newCat.ID] = newCat
			newCategoryID = newCat.ID
		}
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

func saveDatabase() error {
	db := Database{
		Categories: categoriesToSortedSlice(),
		Bookmarks:  bookmarksToSortedSlice(),
	}

	data, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dbFile, data, 0644)
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
	setCORSHeaders(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

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
