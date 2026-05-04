package caddy

import (
	"fmt"
	"regexp"
	"strings"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// compileMatchers converts proto Matchers into Caddy match sets.
// Each proto Matcher becomes one match set (OR semantics between matchers).
func compileMatchers(matchers []*riokuv1.Matcher) ([]map[string]any, error) {
	var sets []map[string]any
	for _, m := range matchers {
		set, err := compileMatcherSet(m)
		if err != nil {
			return nil, err
		}
		if len(set) > 0 {
			sets = append(sets, set)
		}
	}
	return sets, nil
}

// compileMatcherSet builds a single Caddy match set from one proto
// Matcher. Pulled out of compileMatchers so the `not` clause can
// recurse without rebuilding the outer slice.
func compileMatcherSet(m *riokuv1.Matcher) (map[string]any, error) {
	set := make(map[string]any)

	if len(m.GetHosts()) > 0 {
		set["host"] = m.GetHosts()
	}

	paths, pathRegexp, err := compilePaths(m.GetPaths())
	if err != nil {
		return nil, fmt.Errorf("compile paths: %w", err)
	}
	if len(paths) > 0 {
		set["path"] = paths
	}
	if pathRegexp != nil {
		set["path_regexp"] = pathRegexp
	}

	if len(m.GetMethods()) > 0 {
		set["method"] = m.GetMethods()
	}

	header, headerRegexp, err := compileHeaders(m.GetHeaders())
	if err != nil {
		return nil, err
	}
	if len(header) > 0 {
		set["header"] = header
	}
	if len(headerRegexp) > 0 {
		set["header_regexp"] = headerRegexp
	}

	if q := compileQueries(m.GetQueries()); len(q) > 0 {
		set["query"] = q
	}

	if expr := m.GetExpression(); expr != "" {
		set["expression"] = expr
	}

	if nots := m.GetNot(); len(nots) > 0 {
		notSets := make([]map[string]any, 0, len(nots))
		for _, sub := range nots {
			s, err := compileMatcherSet(sub)
			if err != nil {
				return nil, fmt.Errorf("compile not matcher: %w", err)
			}
			if len(s) > 0 {
				notSets = append(notSets, s)
			}
		}
		if len(notSets) > 0 {
			set["not"] = notSets
		}
	}

	return set, nil
}

// compilePaths separates prefix/exact paths (returned as string slice) from
// regexp paths (returned as a path_regexp object). Only the first regexp
// matcher is used because Caddy's path_regexp is a single object per match set.
func compilePaths(paths []*riokuv1.PathMatcher) ([]string, map[string]any, error) {
	var plain []string
	var re map[string]any
	regexpCount := 0

	for _, p := range paths {
		switch p.GetType() {
		case riokuv1.PathMatcher_TYPE_PREFIX:
			v := p.GetValue()
			if !strings.HasSuffix(v, "*") {
				v = strings.TrimSuffix(v, "/") + "/*"
			}
			plain = append(plain, v)
		case riokuv1.PathMatcher_TYPE_EXACT:
			plain = append(plain, p.GetValue())
		case riokuv1.PathMatcher_TYPE_REGEXP:
			regexpCount++
			if regexpCount > 1 {
				return nil, nil, fmt.Errorf("only one regexp path matcher per match set is supported (got %d); split into separate matchers", regexpCount)
			}
			// Validate the regex compiles before sending to Caddy.
			if _, err := regexp.Compile(p.GetValue()); err != nil {
				return nil, nil, fmt.Errorf("invalid path regexp %q: %w", p.GetValue(), err)
			}
			re = map[string]any{
				"pattern": p.GetValue(),
			}
		}
	}
	return plain, re, nil
}

// compileHeaders converts proto HeaderMatchers into Caddy header
// match format, splitting plain entries (`header`) from regex entries
// (`header_regexp`). Plain Caddy format: {"Header-Name": ["value"]}.
// Regex format: {"Header-Name": {"pattern": "..."}}.
//
// Returns (header, header_regexp, error). Either or both maps may be
// empty. An invalid regex pattern produces an error so the operator
// finds out at compile time, not at request time.
func compileHeaders(headers []*riokuv1.HeaderMatcher) (map[string][]string, map[string]map[string]any, error) {
	plain := make(map[string][]string)
	regexes := make(map[string]map[string]any)
	for _, h := range headers {
		name := h.GetName()
		val := h.GetValue()
		if h.GetRegexp() {
			if _, err := regexp.Compile(val); err != nil {
				return nil, nil, fmt.Errorf("invalid header regexp on %q: %w", name, err)
			}
			// Caddy's header_regexp wants a single object per header
			// name. Last write wins if the operator supplies multiple
			// regex entries for the same header — we surface that as
			// an error so they don't silently lose patterns.
			if _, dup := regexes[name]; dup {
				return nil, nil, fmt.Errorf("multiple regexp matchers for header %q (Caddy header_regexp accepts one pattern per header)", name)
			}
			regexes[name] = map[string]any{"pattern": val}
			continue
		}
		// Caddy uses a "!" prefix on the value to invert the match.
		if h.GetInvert() {
			val = "!" + val
		}
		plain[name] = append(plain[name], val)
	}
	return plain, regexes, nil
}

// compileQueries converts proto QueryMatchers into Caddy's `query`
// match format: {"key": ["v1", "v2", ...]}. Multiple entries with the
// same key fold into a single slice (OR semantics). An empty value
// matches any value (existence-only check).
func compileQueries(queries []*riokuv1.QueryMatcher) map[string][]string {
	if len(queries) == 0 {
		return nil
	}
	result := make(map[string][]string, len(queries))
	for _, q := range queries {
		result[q.GetKey()] = append(result[q.GetKey()], q.GetValue())
	}
	return result
}
