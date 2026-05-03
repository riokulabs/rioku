package strategies

import (
	"math"
	"math/rand"
	"sort"
	"sync"
)

// simpleShuffle is weighted-random selection across upstreams.
// Per request the strategy returns the upstreams in a randomized
// order biased by Weight; this gives natural load-spreading without
// the operator having to think about EWMA behavior.
type simpleShuffle struct {
	mu  sync.Mutex
	rng *rand.Rand
}

// NewSimpleShuffle returns a Strategy that picks upstreams via
// weight-biased random shuffle. The RNG is seeded from the global
// runtime source on construction so two routers do not produce
// identical sequences.
func NewSimpleShuffle() Strategy {
	return &simpleShuffle{
		rng: rand.New(rand.NewSource(rand.Int63())), //nolint:gosec // routing, not crypto
	}
}

func (s *simpleShuffle) Name() string { return "simple_shuffle" }

// Pick returns upstreams in weighted-random order. Upstreams with
// Weight <= 0 are treated as Weight = 1 (operator forgot to set
// weights — still routable, just uniform).
func (s *simpleShuffle) Pick(upstreams []Upstream) []Upstream {
	if len(upstreams) == 0 {
		return nil
	}
	out := make([]Upstream, len(upstreams))
	copy(out, upstreams)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Assign each upstream a sort key inversely proportional to
	// its weight: smaller key = picked first. -log(rand)/weight
	// is the classic A-Res reservoir sampling key, which yields
	// the right marginal distribution across weights.
	type keyed struct {
		u   Upstream
		key float64
	}
	keys := make([]keyed, len(out))
	for i, u := range out {
		w := u.Weight
		if w <= 0 {
			w = 1
		}
		// -ln(r)/w; small r => large key, but normalised by weight.
		// Equivalent ordering: pow(rand, 1/w) descending.
		// We use pow for numerical stability vs log for tiny rand.
		r := s.rng.Float64()
		if r == 0 {
			r = 1e-12
		}
		// pow(r, 1/w): larger w => closer to 1 => sorted later when ascending
		// we want larger weight first => sort descending by pow(r, 1/w)
		keys[i] = keyed{u, math.Pow(r, 1.0/float64(w))}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].key > keys[j].key })
	for i, k := range keys {
		out[i] = k.u
	}
	return out
}

// Observe is a no-op for simple_shuffle (stateless across requests).
func (s *simpleShuffle) Observe(_ Outcome) {}
