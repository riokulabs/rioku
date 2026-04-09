// Package cache provides a distributed response cache using groupcache
// for peer-to-peer distributed caching with consistent hashing, and otter
// as a local L1 hot cache with W-TinyLFU admission policy.
//
// This is the zero-dependency cache tier for small clusters (3-7 nodes).
// For high-load production, Valkey/Redis/KeyDB is the recommended path.
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/groupcache/groupcache-go/v3"
	"github.com/groupcache/groupcache-go/v3/transport"
	"github.com/groupcache/groupcache-go/v3/transport/peer"
	"github.com/maypok86/otter"
)

// GetterFunc is called on a cache miss to populate the value.
// It should fetch the value from the original source (e.g. upstream HTTP response).
type GetterFunc func(ctx context.Context, key string) ([]byte, time.Duration, error)

// Config configures the distributed cache.
type Config struct {
	// ListenAddr is the address this node listens on for peer traffic (e.g. "192.168.1.1:8080").
	ListenAddr string
	// Peers is the list of all peer addresses including this node.
	Peers []string
	// MaxBytes is the maximum cache size in bytes for groupcache (default 64MB).
	MaxBytes int64
	// L1MaxSize is the max number of entries in the otter L1 hot cache (default 10000).
	L1MaxSize int
	// DefaultTTL is the default TTL for cache entries (default 5 minutes).
	DefaultTTL time.Duration
}

// DistributedCache wraps groupcache + otter for a two-tier cache.
type DistributedCache struct {
	instance *groupcache.Instance
	daemon   *groupcache.Daemon
	group    groupcache.Group
	l1       otter.Cache[string, cacheEntry]
	getter   GetterFunc
	config   Config
}

type cacheEntry struct {
	Data      []byte
	ExpiresAt time.Time
}

// New creates a new DistributedCache.
func New(ctx context.Context, name string, getter GetterFunc, cfg Config) (*DistributedCache, error) {
	if cfg.MaxBytes == 0 {
		cfg.MaxBytes = 64 * 1024 * 1024 // 64MB
	}
	if cfg.L1MaxSize == 0 {
		cfg.L1MaxSize = 10000
	}
	if cfg.DefaultTTL == 0 {
		cfg.DefaultTTL = 5 * time.Minute
	}

	dc := &DistributedCache{
		getter: getter,
		config: cfg,
	}

	// Initialize otter L1 hot cache.
	l1, err := otter.MustBuilder[string, cacheEntry](cfg.L1MaxSize).
		WithTTL(cfg.DefaultTTL).
		Build()
	if err != nil {
		return nil, fmt.Errorf("cache: create otter L1: %w", err)
	}
	dc.l1 = l1

	// Initialize groupcache daemon.
	daemon, err := groupcache.ListenAndServe(ctx, cfg.ListenAddr, groupcache.Options{})
	if err != nil {
		return nil, fmt.Errorf("cache: start groupcache daemon: %w", err)
	}
	dc.daemon = daemon
	dc.instance = daemon.GetInstance()

	// Set peers.
	peers := make([]peer.Info, 0, len(cfg.Peers))
	for _, addr := range cfg.Peers {
		peers = append(peers, peer.Info{
			Address: addr,
			IsSelf:  addr == cfg.ListenAddr,
		})
	}
	if err := dc.instance.SetPeers(ctx, peers); err != nil {
		_ = daemon.Shutdown(ctx)
		return nil, fmt.Errorf("cache: set peers: %w", err)
	}

	// Create the groupcache group with the getter.
	gcGetter := groupcache.GetterFunc(func(ctx context.Context, key string, dest transport.Sink) error {
		data, ttl, err := dc.getter(ctx, key)
		if err != nil {
			return err
		}
		expire := time.Now().Add(ttl)
		if ttl == 0 {
			expire = time.Now().Add(cfg.DefaultTTL)
		}
		return dest.SetBytes(data, expire)
	})

	group, err := dc.instance.NewGroup(name, cfg.MaxBytes, gcGetter)
	if err != nil {
		_ = daemon.Shutdown(ctx)
		return nil, fmt.Errorf("cache: create group: %w", err)
	}
	dc.group = group

	return dc, nil
}

// Get retrieves a value from the cache. Checks L1 first, then groupcache
// (which handles peer fetch and single-flight dedup internally).
func (dc *DistributedCache) Get(ctx context.Context, key string) ([]byte, error) {
	// L1 check — fastest path.
	if entry, ok := dc.l1.Get(key); ok {
		if time.Now().Before(entry.ExpiresAt) {
			return entry.Data, nil
		}
		dc.l1.Delete(key)
	}

	// Groupcache handles: consistent hash to owner, peer fetch, single-flight dedup.
	var data []byte
	if err := dc.group.Get(ctx, key, transport.AllocatingByteSliceSink(&data)); err != nil {
		return nil, fmt.Errorf("cache: get %q: %w", key, err)
	}

	// Populate L1 for future hot-path access.
	dc.l1.Set(key, cacheEntry{
		Data:      data,
		ExpiresAt: time.Now().Add(dc.config.DefaultTTL),
	})

	return data, nil
}

// Set explicitly sets a cache value (bypassing the getter).
func (dc *DistributedCache) Set(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	if ttl == 0 {
		ttl = dc.config.DefaultTTL
	}
	expire := time.Now().Add(ttl)

	// Set in L1.
	dc.l1.Set(key, cacheEntry{Data: data, ExpiresAt: expire})

	// Set in groupcache.
	return dc.group.Set(ctx, key, data, expire, false)
}

// Remove removes a key from both L1 and groupcache (including peers).
func (dc *DistributedCache) Remove(ctx context.Context, key string) error {
	dc.l1.Delete(key)
	return dc.group.Remove(ctx, key)
}

// Stats returns cache statistics.
func (dc *DistributedCache) Stats() CacheStats {
	gs := dc.group.GroupStats()
	mainBytes, hotBytes := dc.group.UsedBytes()
	return CacheStats{
		Gets:           gs.Gets.Get(),
		CacheHits:      gs.CacheHits.Get(),
		PeerLoads:      gs.PeerLoads.Get(),
		PeerErrors:     gs.PeerErrors.Get(),
		Loads:          gs.Loads.Get(),
		LocalLoads:     gs.LocalLoads.Get(),
		LoadErrors:     gs.LocalLoadErrs.Get(),
		MainCacheBytes: mainBytes,
		HotCacheBytes:  hotBytes,
		L1Size:         dc.l1.Size(),
	}
}

// Shutdown cleanly shuts down the cache.
func (dc *DistributedCache) Shutdown(ctx context.Context) error {
	dc.l1.Close()
	return dc.daemon.Shutdown(ctx)
}

// CacheStats contains cache hit/miss statistics.
type CacheStats struct {
	Gets           int64
	CacheHits      int64
	PeerLoads      int64
	PeerErrors     int64
	Loads          int64
	LocalLoads     int64
	LoadErrors     int64
	MainCacheBytes int64
	HotCacheBytes  int64
	L1Size         int
}
