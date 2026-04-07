package main

import (
	"container/list"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// ---- Config ----------------------------------------------------------------

type Config struct {
	Port       int
	MaxConns   int
	ErrorRate  float64
	LatencyMin time.Duration
	LatencyMax time.Duration
}

func parseConfig() Config {
	port := flag.Int("port", 9002, "listen port")
	maxConns := flag.Int("max-conns", 100, "max concurrent connections")
	errorRate := flag.Float64("error-rate", 2.0, "error injection rate (percent, 0-100)")
	latMin := flag.Duration("latency-min", 5*time.Millisecond, "minimum simulated latency")
	latMax := flag.Duration("latency-max", 100*time.Millisecond, "maximum simulated latency")
	flag.Parse()
	return Config{
		Port:       *port,
		MaxConns:   *maxConns,
		ErrorRate:  *errorRate / 100.0,
		LatencyMin: *latMin,
		LatencyMax: *latMax,
	}
}

// ---- Domain ----------------------------------------------------------------

type Category struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Parent string `json:"parent,omitempty"`
}

type ImageRef struct {
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type Pricing struct {
	BasePrice float64  `json:"base_price"`
	SalePrice *float64 `json:"sale_price,omitempty"`
	Currency  string   `json:"currency"`
	Discount  float64  `json:"discount_percent,omitempty"`
}

type Rating struct {
	Average float64 `json:"average"`
	Count   int     `json:"count"`
	Stars   [5]int  `json:"stars"`
}

type Product struct {
	ID          int64              `json:"id"`
	Name        string             `json:"name"`
	Slug        string             `json:"slug"`
	SKU         string             `json:"sku"`
	Description string             `json:"description"`
	Category    Category           `json:"category"`
	Images      []ImageRef         `json:"images"`
	Tags        []string           `json:"tags"`
	Pricing     Pricing            `json:"pricing"`
	Rating      Rating             `json:"rating"`
	Stock       int                `json:"stock"`
	Weight      float64            `json:"weight_kg"`
	Dimensions  map[string]float64 `json:"dimensions_cm"`
	Attributes  map[string]string  `json:"attributes"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

type CreateProductRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	CategoryID  string  `json:"category_id"`
	BasePrice   float64 `json:"base_price"`
}

// ---- Seed data -------------------------------------------------------------

var categories = []Category{
	{ID: "cat-elec", Name: "Electronics", Slug: "electronics", Parent: ""},
	{ID: "cat-elec-phones", Name: "Smartphones", Slug: "smartphones", Parent: "cat-elec"},
	{ID: "cat-elec-laptops", Name: "Laptops", Slug: "laptops", Parent: "cat-elec"},
	{ID: "cat-elec-audio", Name: "Audio", Slug: "audio", Parent: "cat-elec"},
	{ID: "cat-elec-cameras", Name: "Cameras", Slug: "cameras", Parent: "cat-elec"},
	{ID: "cat-clothing", Name: "Clothing", Slug: "clothing", Parent: ""},
	{ID: "cat-clothing-mens", Name: "Men's Clothing", Slug: "mens-clothing", Parent: "cat-clothing"},
	{ID: "cat-clothing-womens", Name: "Women's Clothing", Slug: "womens-clothing", Parent: "cat-clothing"},
	{ID: "cat-clothing-kids", Name: "Kids' Clothing", Slug: "kids-clothing", Parent: "cat-clothing"},
	{ID: "cat-home", Name: "Home & Garden", Slug: "home-garden", Parent: ""},
	{ID: "cat-home-kitchen", Name: "Kitchen", Slug: "kitchen", Parent: "cat-home"},
	{ID: "cat-home-furniture", Name: "Furniture", Slug: "furniture", Parent: "cat-home"},
	{ID: "cat-home-tools", Name: "Tools", Slug: "tools", Parent: "cat-home"},
	{ID: "cat-sports", Name: "Sports & Outdoors", Slug: "sports-outdoors", Parent: ""},
	{ID: "cat-sports-fitness", Name: "Fitness", Slug: "fitness", Parent: "cat-sports"},
	{ID: "cat-sports-camping", Name: "Camping", Slug: "camping", Parent: "cat-sports"},
	{ID: "cat-books", Name: "Books", Slug: "books", Parent: ""},
	{ID: "cat-books-tech", Name: "Technology Books", Slug: "tech-books", Parent: "cat-books"},
	{ID: "cat-books-fiction", Name: "Fiction", Slug: "fiction", Parent: "cat-books"},
	{ID: "cat-beauty", Name: "Beauty & Personal Care", Slug: "beauty", Parent: ""},
}

var adjectives = []string{
	"Premium", "Ultra", "Pro", "Advanced", "Elite", "Smart", "Wireless", "Portable",
	"Compact", "Deluxe", "Classic", "Modern", "Slim", "Heavy-Duty", "Eco-Friendly",
	"High-Performance", "Lightweight", "Ergonomic", "Multi-Function", "Foldable",
	"Rechargeable", "Waterproof", "Noise-Cancelling", "Fast-Charging", "Solar-Powered",
}

var productNames = []string{
	"Headphones", "Laptop Stand", "Mechanical Keyboard", "Gaming Mouse", "Monitor",
	"Webcam", "USB Hub", "Cable Organizer", "Desk Mat", "Phone Case",
	"Screen Protector", "Charging Pad", "Power Bank", "Earbuds", "Speaker",
	"Tablet", "Smartwatch", "Fitness Tracker", "Camera Lens", "Tripod",
	"Running Shoes", "Yoga Mat", "Resistance Bands", "Jump Rope", "Water Bottle",
	"Backpack", "Sleeping Bag", "Tent", "Hiking Boots", "Cycling Gloves",
	"Coffee Maker", "Blender", "Air Fryer", "Instant Pot", "Knife Set",
	"Cutting Board", "Mixing Bowls", "Baking Sheet", "Dutch Oven", "Spice Rack",
	"Bookshelf", "Desk Chair", "Standing Desk", "Bedside Table", "Floor Lamp",
	"T-Shirt", "Jeans", "Hoodie", "Sneakers", "Dress Shoes",
	"Winter Jacket", "Rain Coat", "Swim Trunks", "Leggings", "Polo Shirt",
	"Novel", "Programming Guide", "Design Handbook", "Science Textbook", "Recipe Book",
	"Face Cream", "Shampoo", "Conditioner", "Sunscreen", "Lip Balm",
}

var descParagraphs = []string{
	"Crafted with premium materials and engineered for exceptional performance, this product delivers unmatched quality in every use. Whether you're a professional or an enthusiast, you'll appreciate the attention to detail that went into every aspect of its design.",
	"Built to withstand the demands of daily use, this item combines durability with elegant aesthetics. The innovative construction ensures long-lasting reliability while maintaining the sleek appearance that modern consumers expect.",
	"Experience the difference that thoughtful engineering makes. Every feature has been carefully considered to enhance your workflow and elevate your everyday experience. The intuitive design means you'll be up and running in minutes.",
	"Designed with sustainability in mind, this product minimizes environmental impact without compromising on performance. The eco-friendly manufacturing process uses recycled materials and reduces waste at every stage of production.",
	"Trusted by thousands of customers worldwide, this product has consistently received top ratings for quality, reliability, and value. Join the community of satisfied users who have made this their go-to choice.",
	"The latest generation incorporates cutting-edge technology improvements based on extensive user feedback. Enhanced algorithms and refined components deliver a noticeably superior experience compared to previous versions.",
	"Perfect for both beginners and experts, this versatile product adapts to your skill level and grows with you over time. Comprehensive documentation and dedicated support ensure you get the most out of every feature.",
	"With an industry-leading warranty and responsive customer service team, you can purchase with confidence. Our quality control process ensures every unit meets rigorous standards before it reaches your hands.",
	"The ergonomic design reduces fatigue during extended use, making this ideal for professionals who rely on their tools throughout the day. Thoughtful touches like adjustable components and soft-touch materials enhance comfort significantly.",
	"Compatibility has been a priority throughout development. This product works seamlessly with a wide range of existing systems and accessories, protecting your investment and integrating smoothly into your current setup.",
	"Advanced connectivity options keep you linked to what matters most. Whether you prefer wired or wireless connections, this product offers multiple interfaces to suit any environment or preference.",
	"Storage and portability were key considerations during the design phase. The included carrying case and compact form factor make transport effortless, while adequate onboard storage eliminates the need for additional accessories.",
	"Performance benchmarks consistently place this product at the top of its category. Independent tests confirm its superiority in speed, accuracy, and efficiency compared to competitive alternatives at similar price points.",
	"The premium finish resists scratches, fingerprints, and everyday wear, keeping your product looking new even after months of regular use. Easy cleaning and maintenance further simplify ownership.",
	"Intuitive controls and a clean interface mean the learning curve is minimal. Users of all technical backgrounds report being comfortable with all core features within their first session.",
}

var tagPool = []string{
	"bestseller", "new-arrival", "sale", "limited-edition", "eco-friendly", "premium",
	"wireless", "portable", "waterproof", "rechargeable", "fast-shipping", "gift-idea",
	"bundle-available", "extended-warranty", "top-rated", "staff-pick", "clearance",
	"handmade", "smart-home", "gaming", "professional", "beginner-friendly", "travel",
	"office", "outdoor", "indoor", "compact", "heavy-duty", "lightweight", "ergonomic",
}

var brands = []string{
	"TechNova", "Luminos", "ProCraft", "NexGen", "CoreLine", "PureForm",
	"ApexTech", "StellarMade", "UrbanGear", "NatureFirst", "SwiftBuild",
	"ClearPath", "StormEdge", "IronClad", "SoftTouch", "BrightMind",
	"GreenLeaf", "BlueWave", "RedRidge", "GoldMark",
}

var colorValues = []string{
	"Midnight Black", "Arctic White", "Storm Gray", "Ocean Blue", "Forest Green",
	"Crimson Red", "Desert Sand", "Rose Gold", "Matte Silver", "Cobalt Blue",
}

func generateDescription(rng *rand.Rand, minLen, maxLen int) string {
	var sb strings.Builder
	target := minLen + rng.Intn(maxLen-minLen)
	for sb.Len() < target {
		p := descParagraphs[rng.Intn(len(descParagraphs))]
		if sb.Len() > 0 {
			sb.WriteString(" ")
		}
		sb.WriteString(p)
	}
	s := sb.String()
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

func seedProducts(n int, rng *rand.Rand) []*Product {
	products := make([]*Product, 0, n)
	now := time.Now().UTC()

	for i := 1; i <= n; i++ {
		cat := categories[rng.Intn(len(categories))]
		adj := adjectives[rng.Intn(len(adjectives))]
		noun := productNames[rng.Intn(len(productNames))]
		brand := brands[rng.Intn(len(brands))]
		name := fmt.Sprintf("%s %s %s", brand, adj, noun)
		slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))
		sku := fmt.Sprintf("SKU-%06d", i)

		desc := generateDescription(rng, 100, 2000)

		basePrice := 9.99 + rng.Float64()*990.0
		basePrice = float64(int(basePrice*100)) / 100.0

		var salePrice *float64
		var discountPct float64
		if rng.Float32() < 0.3 {
			disc := 0.05 + rng.Float64()*0.45
			sp := basePrice * (1 - disc)
			sp = float64(int(sp*100)) / 100.0
			salePrice = &sp
			discountPct = float64(int(disc*1000)) / 10.0
		}

		numImages := 1 + rng.Intn(4)
		images := make([]ImageRef, numImages)
		for j := 0; j < numImages; j++ {
			w := 800 + rng.Intn(1200)
			h := 600 + rng.Intn(600)
			images[j] = ImageRef{
				URL:    fmt.Sprintf("https://images.example.com/products/%d/img%d.jpg", i, j+1),
				Alt:    fmt.Sprintf("%s image %d", name, j+1),
				Width:  w,
				Height: h,
			}
		}

		numTags := 2 + rng.Intn(6)
		tagSet := make(map[string]bool)
		tags := make([]string, 0, numTags)
		for len(tags) < numTags {
			t := tagPool[rng.Intn(len(tagPool))]
			if !tagSet[t] {
				tagSet[t] = true
				tags = append(tags, t)
			}
		}

		avgRating := 2.5 + rng.Float64()*2.5
		avgRating = float64(int(avgRating*10)) / 10.0
		totalReviews := 5 + rng.Intn(2000)
		var stars [5]int
		rem := totalReviews
		for s := 4; s >= 1; s-- {
			share := rng.Intn(rem / (s + 1))
			stars[s] = share
			rem -= share
		}
		stars[0] = rem

		created := now.Add(-time.Duration(rng.Intn(730*24)) * time.Hour)

		p := &Product{
			ID:          int64(i),
			Name:        name,
			Slug:        slug,
			SKU:         sku,
			Description: desc,
			Category:    cat,
			Images:      images,
			Tags:        tags,
			Pricing: Pricing{
				BasePrice: basePrice,
				SalePrice: salePrice,
				Currency:  "USD",
				Discount:  discountPct,
			},
			Rating: Rating{
				Average: avgRating,
				Count:   totalReviews,
				Stars:   stars,
			},
			Stock:  rng.Intn(1000),
			Weight: float64(int((0.1+rng.Float64()*49.9)*100)) / 100.0,
			Dimensions: map[string]float64{
				"length": float64(int((5+rng.Float64()*95)*10)) / 10.0,
				"width":  float64(int((5+rng.Float64()*95)*10)) / 10.0,
				"height": float64(int((5+rng.Float64()*95)*10)) / 10.0,
			},
			Attributes: map[string]string{
				"brand":    brand,
				"color":    colorValues[rng.Intn(len(colorValues))],
				"material": []string{"aluminum", "plastic", "steel", "fabric", "leather", "wood", "glass"}[rng.Intn(7)],
				"warranty": []string{"1 year", "2 years", "3 years", "lifetime"}[rng.Intn(4)],
			},
			CreatedAt: created,
			UpdatedAt: created.Add(time.Duration(rng.Intn(30*24)) * time.Hour),
		}
		products = append(products, p)
	}
	return products
}

// ---- Catalog (in-memory store) ---------------------------------------------

type Catalog struct {
	mu      sync.RWMutex
	byID    map[int64]*Product
	ordered []int64
	nextID  int64
}

func NewCatalog(seed []*Product) *Catalog {
	c := &Catalog{
		byID:    make(map[int64]*Product, len(seed)),
		ordered: make([]int64, 0, len(seed)),
	}
	for _, p := range seed {
		c.byID[p.ID] = p
		c.ordered = append(c.ordered, p.ID)
		if p.ID >= c.nextID {
			c.nextID = p.ID + 1
		}
	}
	return c
}

func (c *Catalog) List(page, pageSize int, categoryFilter string) ([]*Product, int) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	cf := strings.ToLower(categoryFilter)
	var matched []*Product
	for _, id := range c.ordered {
		p := c.byID[id]
		if cf != "" && !strings.EqualFold(p.Category.ID, cf) &&
			!strings.EqualFold(p.Category.Slug, cf) &&
			!strings.Contains(strings.ToLower(p.Category.Name), cf) {
			continue
		}
		matched = append(matched, p)
	}

	total := len(matched)
	if pageSize <= 0 {
		pageSize = 20
	}
	if page <= 0 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []*Product{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return matched[start:end], total
}

func (c *Catalog) Get(id int64) (*Product, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	p, ok := c.byID[id]
	return p, ok
}

func (c *Catalog) Search(q string) []*Product {
	c.mu.RLock()
	defer c.mu.RUnlock()

	q = strings.ToLower(q)
	var results []*Product
	// Deliberate O(n) full-text scan to simulate search degradation under load
	for _, id := range c.ordered {
		p := c.byID[id]
		if strings.Contains(strings.ToLower(p.Name), q) ||
			strings.Contains(strings.ToLower(p.Description), q) ||
			strings.Contains(strings.ToLower(p.Category.Name), q) ||
			tagsContain(p.Tags, q) {
			results = append(results, p)
			if len(results) >= 50 {
				break
			}
		}
	}
	return results
}

func tagsContain(tags []string, q string) bool {
	for _, t := range tags {
		if strings.Contains(t, q) {
			return true
		}
	}
	return false
}

func (c *Catalog) Create(name, description, categoryID string, basePrice float64) (*Product, bool) {
	// Find the category
	var cat Category
	found := false
	for _, cc := range categories {
		if cc.ID == categoryID {
			cat = cc
			found = true
			break
		}
	}
	if !found {
		return nil, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now().UTC()
	p := &Product{
		ID:          c.nextID,
		Name:        name,
		Slug:        strings.ToLower(strings.ReplaceAll(name, " ", "-")),
		SKU:         fmt.Sprintf("SKU-%06d", c.nextID),
		Description: description,
		Category:    cat,
		Images:      []ImageRef{},
		Tags:        []string{},
		Pricing: Pricing{
			BasePrice: basePrice,
			Currency:  "USD",
		},
		Rating: Rating{
			Average: 0,
			Count:   0,
		},
		Stock:      0,
		Weight:     0,
		Dimensions: map[string]float64{},
		Attributes: map[string]string{},
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	c.nextID++
	c.byID[p.ID] = p
	c.ordered = append(c.ordered, p.ID)
	return p, true
}

func (c *Catalog) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.ordered)
}

// ---- LRU Cache -------------------------------------------------------------

// lruCache is a fixed-capacity LRU cache mapping product ID to *Product.
// First access triggers a simulated DB miss (slow). Subsequent hits are fast.
type lruEntry struct {
	id      int64
	product *Product
}

type LRUCache struct {
	mu       sync.Mutex
	capacity int
	items    map[int64]*list.Element
	order    *list.List
	hits     atomic.Int64
	misses   atomic.Int64
}

func NewLRUCache(capacity int) *LRUCache {
	return &LRUCache{
		capacity: capacity,
		items:    make(map[int64]*list.Element, capacity),
		order:    list.New(),
	}
}

// Get returns (product, cacheHit). If not cached, returns nil, false.
func (c *LRUCache) Get(id int64) (*Product, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[id]
	if !ok {
		c.misses.Add(1)
		return nil, false
	}
	c.order.MoveToFront(el)
	c.hits.Add(1)
	return el.Value.(*lruEntry).product, true
}

// Put inserts or updates a product in the cache, evicting LRU item if at capacity.
func (c *LRUCache) Put(p *Product) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[p.ID]; ok {
		c.order.MoveToFront(el)
		el.Value.(*lruEntry).product = p
		return
	}
	if c.order.Len() >= c.capacity {
		back := c.order.Back()
		if back != nil {
			c.order.Remove(back)
			delete(c.items, back.Value.(*lruEntry).id)
		}
	}
	entry := &lruEntry{id: p.ID, product: p}
	el := c.order.PushFront(entry)
	c.items[p.ID] = el
}

func (c *LRUCache) Stats() (hits, misses int64) {
	return c.hits.Load(), c.misses.Load()
}

// ---- Metrics ---------------------------------------------------------------

type Metrics struct {
	totalRequests  atomic.Int64
	activeConns    atomic.Int64
	errorCount     atomic.Int64
	requestsBy2xx  atomic.Int64
	requestsBy4xx  atomic.Int64
	requestsBy5xx  atomic.Int64
	cacheHits      atomic.Int64
	cacheMisses    atomic.Int64
	searchRequests atomic.Int64
}

func (m *Metrics) Text(cacheHits, cacheMisses int64, catalogSize int) string {
	var sb strings.Builder
	sb.WriteString("# HELP products_requests_total Total HTTP requests received\n")
	sb.WriteString("# TYPE products_requests_total counter\n")
	fmt.Fprintf(&sb, "products_requests_total %d\n", m.totalRequests.Load())
	sb.WriteString("# HELP products_active_connections Current active connections\n")
	sb.WriteString("# TYPE products_active_connections gauge\n")
	fmt.Fprintf(&sb, "products_active_connections %d\n", m.activeConns.Load())
	sb.WriteString("# HELP products_errors_total Total injected or real errors\n")
	sb.WriteString("# TYPE products_errors_total counter\n")
	fmt.Fprintf(&sb, "products_errors_total %d\n", m.errorCount.Load())
	sb.WriteString("# HELP products_responses_total Responses by status class\n")
	sb.WriteString("# TYPE products_responses_total counter\n")
	fmt.Fprintf(&sb, "products_responses_total{status=\"2xx\"} %d\n", m.requestsBy2xx.Load())
	fmt.Fprintf(&sb, "products_responses_total{status=\"4xx\"} %d\n", m.requestsBy4xx.Load())
	fmt.Fprintf(&sb, "products_responses_total{status=\"5xx\"} %d\n", m.requestsBy5xx.Load())
	sb.WriteString("# HELP products_cache_hits_total LRU cache hits\n")
	sb.WriteString("# TYPE products_cache_hits_total counter\n")
	fmt.Fprintf(&sb, "products_cache_hits_total %d\n", cacheHits)
	sb.WriteString("# HELP products_cache_misses_total LRU cache misses\n")
	sb.WriteString("# TYPE products_cache_misses_total counter\n")
	fmt.Fprintf(&sb, "products_cache_misses_total %d\n", cacheMisses)
	sb.WriteString("# HELP products_catalog_size Total products in catalog\n")
	sb.WriteString("# TYPE products_catalog_size gauge\n")
	fmt.Fprintf(&sb, "products_catalog_size %d\n", catalogSize)
	sb.WriteString("# HELP products_search_requests_total Total search requests\n")
	sb.WriteString("# TYPE products_search_requests_total counter\n")
	fmt.Fprintf(&sb, "products_search_requests_total %d\n", m.searchRequests.Load())
	return sb.String()
}

// ---- Server ----------------------------------------------------------------

type Server struct {
	cfg     Config
	catalog *Catalog
	cache   *LRUCache
	metrics *Metrics
	rng     *rand.Rand
	rngMu   sync.Mutex
}

func NewServer(cfg Config, catalog *Catalog) *Server {
	return &Server{
		cfg:     cfg,
		catalog: catalog,
		cache:   NewLRUCache(500),
		metrics: &Metrics{},
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (s *Server) randFloat() float64 {
	s.rngMu.Lock()
	v := s.rng.Float64()
	s.rngMu.Unlock()
	return v
}

func (s *Server) injectLatency(scale float64) {
	span := float64(s.cfg.LatencyMax - s.cfg.LatencyMin)
	jitter := time.Duration(s.randFloat() * span * scale)
	time.Sleep(s.cfg.LatencyMin + jitter)
}

func (s *Server) middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.metrics.totalRequests.Add(1)
		active := s.metrics.activeConns.Add(1)
		defer s.metrics.activeConns.Add(-1)

		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("prd-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", reqID)
		w.Header().Set("Content-Type", "application/json")

		if int(active) > s.cfg.MaxConns {
			s.metrics.requestsBy5xx.Add(1)
			s.metrics.errorCount.Add(1)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "too many connections"})
			log.Printf("%s %s 503 %s [conns=%d] %v", r.Method, r.URL.Path, reqID, active, time.Since(start))
			return
		}

		if s.cfg.ErrorRate > 0 && s.randFloat() < s.cfg.ErrorRate {
			s.metrics.requestsBy5xx.Add(1)
			s.metrics.errorCount.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": "injected error"})
			log.Printf("%s %s 500 %s [injected] %v", r.Method, r.URL.Path, reqID, time.Since(start))
			return
		}

		rw := &responseWriter{ResponseWriter: w, status: 200}
		next(rw, r)

		switch {
		case rw.status >= 500:
			s.metrics.requestsBy5xx.Add(1)
		case rw.status >= 400:
			s.metrics.requestsBy4xx.Add(1)
		default:
			s.metrics.requestsBy2xx.Add(1)
		}
		log.Printf("%s %s %d %s %v", r.Method, r.URL.Path, rw.status, reqID, time.Since(start))
	}
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// ---- Handlers --------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	hits, misses := s.cache.Stats()
	json.NewEncoder(w).Encode(map[string]any{
		"status":       "ok",
		"app":          "products",
		"catalog_size": s.catalog.Size(),
		"cache_hits":   hits,
		"cache_misses": misses,
		"time":         time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	hits, misses := s.cache.Stats()
	fmt.Fprint(w, s.metrics.Text(hits, misses, s.catalog.Size()))
}

func (s *Server) handleListProducts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	category := q.Get("category")

	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	if page <= 0 {
		page = 1
	}

	products, total := s.catalog.List(page, pageSize, category)

	// Scale latency with page size — larger pages produce heavier payloads
	scale := 0.3 + 0.7*float64(len(products))/float64(pageSize)
	s.injectLatency(scale)

	json.NewEncoder(w).Encode(map[string]any{
		"data":      products,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

func (s *Server) handleGetProduct(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r.URL.Path, "/products/")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid id"})
		return
	}

	// Check LRU cache first
	p, hit := s.cache.Get(id)
	if hit {
		// Cache hit: fast path (2-5ms)
		time.Sleep(2*time.Millisecond + time.Duration(s.randFloat()*3)*time.Millisecond)
		w.Header().Set("X-Cache", "HIT")
		json.NewEncoder(w).Encode(p)
		return
	}

	// Cache miss: slow path (50-100ms simulated DB fetch)
	time.Sleep(50*time.Millisecond + time.Duration(s.randFloat()*50)*time.Millisecond)

	p, ok := s.catalog.Get(id)
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		return
	}
	s.cache.Put(p)
	w.Header().Set("X-Cache", "MISS")
	json.NewEncoder(w).Encode(p)
}

func (s *Server) handleSearchProducts(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "q parameter is required"})
		return
	}

	s.metrics.searchRequests.Add(1)

	// Search is O(n) and deliberately slow — simulate degradation under load
	s.injectLatency(1.5)

	results := s.catalog.Search(q)
	json.NewEncoder(w).Encode(map[string]any{
		"data":  results,
		"total": len(results),
		"query": q,
	})
}

func (s *Server) handleCreateProduct(w http.ResponseWriter, r *http.Request) {
	var req CreateProductRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid JSON"})
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.CategoryID = strings.TrimSpace(req.CategoryID)

	if req.Name == "" {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "name is required"})
		return
	}
	if len(req.Name) < 3 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "name must be at least 3 characters"})
		return
	}
	if req.BasePrice <= 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "base_price must be greater than 0"})
		return
	}
	if req.CategoryID == "" {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "category_id is required"})
		return
	}

	s.injectLatency(1.0)

	p, ok := s.catalog.Create(req.Name, req.Description, req.CategoryID, req.BasePrice)
	if !ok {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid category_id"})
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(p)
}

// ---- Routing ---------------------------------------------------------------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", s.middleware(s.handleHealth))
	mux.HandleFunc("/metrics", s.handleMetrics) // no middleware: metrics never inject errors/latency

	mux.HandleFunc("/products/search", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}
		s.handleSearchProducts(w, r)
	}))

	mux.HandleFunc("/products", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			s.handleListProducts(w, r)
		case http.MethodPost:
			s.handleCreateProduct(w, r)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		}
	}))

	mux.HandleFunc("/products/", s.middleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}
		s.handleGetProduct(w, r)
	}))

	return mux
}

// ---- Helpers ---------------------------------------------------------------

func pathID(path, prefix string) (int64, error) {
	seg := strings.TrimPrefix(path, prefix)
	seg = strings.TrimSuffix(seg, "/")
	if seg == "" {
		return 0, fmt.Errorf("missing id")
	}
	return strconv.ParseInt(seg, 10, 64)
}

// ---- Main ------------------------------------------------------------------

func main() {
	cfg := parseConfig()

	rng := rand.New(rand.NewSource(42))
	products := seedProducts(5000, rng)
	catalog := NewCatalog(products)
	srv := NewServer(cfg, catalog)

	addr := fmt.Sprintf(":%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("listen %s: %v", addr, err)
	}

	httpSrv := &http.Server{
		Handler:      srv.routes(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("products app listening on %s (catalog=%d max-conns=%d error-rate=%.1f%% latency=%v-%v)",
		addr, catalog.Size(), cfg.MaxConns, cfg.ErrorRate*100, cfg.LatencyMin, cfg.LatencyMax)

	go func() {
		if err := httpSrv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	log.Println("stopped")
}
