package auth

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestLRU(t *testing.T) {
	t.Run("set and get hit", func(t *testing.T) {
		c := NewLRU[string](10, time.Minute)
		c.Set("k1", "v1")
		got, ok := c.Get("k1")
		if !ok {
			t.Fatal("expected hit, got miss")
		}
		if got != "v1" {
			t.Fatalf("expected v1, got %s", got)
		}
	})

	t.Run("get miss", func(t *testing.T) {
		c := NewLRU[string](10, time.Minute)
		got, ok := c.Get("nonexistent")
		if ok {
			t.Fatal("expected miss, got hit")
		}
		if got != "" {
			t.Fatalf("expected zero value, got %s", got)
		}
	})

	t.Run("capacity eviction", func(t *testing.T) {
		c := NewLRU[int](3, time.Minute)
		c.Set("a", 1)
		c.Set("b", 2)
		c.Set("c", 3)
		// Cache is full. Adding a fourth should evict "a" (the oldest).
		c.Set("d", 4)

		if _, ok := c.Get("a"); ok {
			t.Fatal("expected 'a' to be evicted")
		}
		for _, key := range []string{"b", "c", "d"} {
			if _, ok := c.Get(key); !ok {
				t.Fatalf("expected %q to still be present", key)
			}
		}
	})

	t.Run("TTL expiry", func(t *testing.T) {
		c := NewLRU[string](10, time.Millisecond)
		c.Set("k1", "v1")
		time.Sleep(5 * time.Millisecond)
		_, ok := c.Get("k1")
		if ok {
			t.Fatal("expected miss after TTL expiry")
		}
		// Expired entry should be removed from cache.
		if c.Len() != 0 {
			t.Fatalf("expected len 0 after expiry removal, got %d", c.Len())
		}
	})

	t.Run("delete", func(t *testing.T) {
		c := NewLRU[string](10, time.Minute)
		c.Set("k1", "v1")
		c.Delete("k1")
		_, ok := c.Get("k1")
		if ok {
			t.Fatal("expected miss after delete")
		}
	})

	t.Run("len", func(t *testing.T) {
		c := NewLRU[int](10, time.Minute)
		if c.Len() != 0 {
			t.Fatalf("expected len 0, got %d", c.Len())
		}
		c.Set("a", 1)
		c.Set("b", 2)
		if c.Len() != 2 {
			t.Fatalf("expected len 2, got %d", c.Len())
		}
		c.Delete("a")
		if c.Len() != 1 {
			t.Fatalf("expected len 1, got %d", c.Len())
		}
	})

	t.Run("update existing", func(t *testing.T) {
		c := NewLRU[string](10, time.Minute)
		c.Set("k1", "v1")
		c.Set("k1", "v2")
		got, ok := c.Get("k1")
		if !ok {
			t.Fatal("expected hit")
		}
		if got != "v2" {
			t.Fatalf("expected v2, got %s", got)
		}
		if c.Len() != 1 {
			t.Fatalf("expected len 1 after update, got %d", c.Len())
		}
	})

	t.Run("concurrent access", func(t *testing.T) {
		c := NewLRU[int](100, time.Minute)
		var wg sync.WaitGroup
		const goroutines = 50
		const ops = 100

		wg.Add(goroutines)
		for i := range goroutines {
			go func(id int) {
				defer wg.Done()
				for j := range ops {
					key := fmt.Sprintf("key-%d-%d", id, j)
					c.Set(key, j)
					c.Get(key)
					c.Delete(key)
				}
			}(i)
		}
		wg.Wait()
		// If we reach here without a race detector failure, the test passes.
	})

	t.Run("eviction order respects access", func(t *testing.T) {
		// Verify that Get promotes an entry so it is not evicted next.
		c := NewLRU[int](3, time.Minute)
		c.Set("a", 1)
		c.Set("b", 2)
		c.Set("c", 3)
		// Access "a" to promote it — now "b" is the LRU.
		c.Get("a")
		c.Set("d", 4) // should evict "b", not "a"

		if _, ok := c.Get("b"); ok {
			t.Fatal("expected 'b' to be evicted after 'a' was promoted")
		}
		if _, ok := c.Get("a"); !ok {
			t.Fatal("expected 'a' to still be present after promotion")
		}
	})

	t.Run("update promotes to head", func(t *testing.T) {
		c := NewLRU[int](3, time.Minute)
		c.Set("a", 1)
		c.Set("b", 2)
		c.Set("c", 3)
		// Update "a" — should promote it, making "b" the LRU.
		c.Set("a", 10)
		c.Set("d", 4) // should evict "b"

		if _, ok := c.Get("b"); ok {
			t.Fatal("expected 'b' to be evicted")
		}
		if v, ok := c.Get("a"); !ok || v != 10 {
			t.Fatalf("expected 'a'=10, got %d, ok=%v", v, ok)
		}
	})

	t.Run("delete nonexistent is noop", func(t *testing.T) {
		c := NewLRU[string](10, time.Minute)
		c.Delete("nonexistent") // should not panic
	})
}
