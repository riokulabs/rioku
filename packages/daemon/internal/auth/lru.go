package auth

import (
	"sync"
	"time"
)

// lruEntry holds a cached value and its expiry.
type lruEntry[V any] struct {
	key     string
	value   V
	expires time.Time
	prev    *lruEntry[V]
	next    *lruEntry[V]
}

// LRU is a thread-safe LRU cache with per-entry TTL.
// It combines a doubly-linked list (for recency ordering) with a map
// (for O(1) lookups). The list is nil-terminated: head is the most
// recently used entry, tail is the least recently used.
type LRU[V any] struct {
	mu       sync.Mutex
	capacity int
	ttl      time.Duration
	items    map[string]*lruEntry[V]
	head     *lruEntry[V] // most recently used
	tail     *lruEntry[V] // least recently used
}

// NewLRU creates an LRU cache with the given capacity and entry TTL.
func NewLRU[V any](capacity int, ttl time.Duration) *LRU[V] {
	return &LRU[V]{
		capacity: capacity,
		ttl:      ttl,
		items:    make(map[string]*lruEntry[V], capacity),
	}
}

// Set inserts or replaces an entry. Evicts the LRU entry when at capacity.
func (c *LRU[V]) Set(key string, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if e, ok := c.items[key]; ok {
		// Update existing entry.
		e.value = value
		e.expires = time.Now().Add(c.ttl)
		c.moveToHead(e)
		return
	}

	// Evict the tail if at capacity.
	if len(c.items) >= c.capacity {
		c.removeTail()
	}

	e := &lruEntry[V]{
		key:     key,
		value:   value,
		expires: time.Now().Add(c.ttl),
	}
	c.items[key] = e
	c.pushHead(e)
}

// Get returns the value for a key and whether it was found and is not expired.
// A found-but-expired entry is treated as a miss and removed.
func (c *LRU[V]) Get(key string) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, ok := c.items[key]
	if !ok {
		var zero V
		return zero, false
	}

	if time.Now().After(e.expires) {
		c.removeEntry(e)
		var zero V
		return zero, false
	}

	c.moveToHead(e)
	return e.value, true
}

// Delete removes an entry from the cache.
func (c *LRU[V]) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, ok := c.items[key]
	if !ok {
		return
	}
	c.removeEntry(e)
}

// Len returns the number of entries currently in the cache (including expired).
func (c *LRU[V]) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// pushHead inserts an entry at the head of the list.
// Caller must hold c.mu.
func (c *LRU[V]) pushHead(e *lruEntry[V]) {
	e.prev = nil
	e.next = c.head
	if c.head != nil {
		c.head.prev = e
	}
	c.head = e
	if c.tail == nil {
		c.tail = e
	}
}

// removeEntry removes an entry from both the map and the list.
// Caller must hold c.mu.
func (c *LRU[V]) removeEntry(e *lruEntry[V]) {
	delete(c.items, e.key)
	c.unlink(e)
}

// removeTail evicts the least recently used entry.
// Caller must hold c.mu.
func (c *LRU[V]) removeTail() {
	if c.tail == nil {
		return
	}
	c.removeEntry(c.tail)
}

// moveToHead moves an existing entry to the head of the list.
// Caller must hold c.mu.
func (c *LRU[V]) moveToHead(e *lruEntry[V]) {
	if c.head == e {
		return
	}
	c.unlink(e)
	c.pushHead(e)
}

// unlink removes an entry from the doubly-linked list without touching the map.
// Caller must hold c.mu.
func (c *LRU[V]) unlink(e *lruEntry[V]) {
	if e.prev != nil {
		e.prev.next = e.next
	} else {
		c.head = e.next
	}
	if e.next != nil {
		e.next.prev = e.prev
	} else {
		c.tail = e.prev
	}
	e.prev = nil
	e.next = nil
}
