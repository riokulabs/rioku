package postgres

import (
	"strings"
	"unicode/utf8"
)

// rewritePlaceholders rewrites `?` positional placeholders to PostgreSQL
// $1, $2, ... syntax. This allows SQL strings written for the SQLite driver
// (which uses `?`) to be reused without a full SQL parser.
//
// Caveats:
//   - `?` inside single-quoted string literals is skipped.
//   - `?` inside double-quoted identifiers is skipped.
//   - Nested/escaped quotes follow standard SQL escaping (”).
//
// A simple state-machine is used; a full SQL parser is not required for the
// subset of queries used in this codebase.
func rewritePlaceholders(query string) string {
	var b strings.Builder
	b.Grow(len(query))

	n := 1        // placeholder counter
	inSQ := false // inside single-quoted string
	inDQ := false // inside double-quoted identifier

	for i := 0; i < len(query); {
		r, size := utf8.DecodeRuneInString(query[i:])

		switch {
		case inSQ:
			b.WriteRune(r)
			i += size
			if r == '\'' {
				// peek for escaped quote ''
				if i < len(query) && query[i] == '\'' {
					b.WriteByte('\'')
					i++
				} else {
					inSQ = false
				}
			}

		case inDQ:
			b.WriteRune(r)
			i += size
			if r == '"' {
				// peek for escaped double-quote ""
				if i < len(query) && query[i] == '"' {
					b.WriteByte('"')
					i++
				} else {
					inDQ = false
				}
			}

		case r == '\'':
			inSQ = true
			b.WriteRune(r)
			i += size

		case r == '"':
			inDQ = true
			b.WriteRune(r)
			i += size

		case r == '?':
			b.WriteByte('$')
			b.WriteString(itoa(n))
			n++
			i += size

		default:
			b.WriteRune(r)
			i += size
		}
	}

	return b.String()
}

// itoa converts a small non-negative integer to its decimal string
// representation. Avoids an import of strconv for the common small case.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
