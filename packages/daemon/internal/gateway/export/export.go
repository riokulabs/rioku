// Package export streams large result sets as downloadable files.
//
// The daemon's audit, AI traces, and dashboard export endpoints feed
// rows into one of these helpers; each row becomes one line in the
// output and is flushed as soon as it's serialised so the client sees
// progress and a slow stream doesn't OOM the daemon.
//
// Two formats are supported:
//
//   - WriteCSV — one header row of column names, then one row per
//     record. Empty input emits the header only.
//   - WriteJSONL — newline-delimited JSON; each record encodes as one
//     compact line.
//
// Both helpers honour `r.Context()`: when the client disconnects, the
// underlying source loop sees the cancelled context and stops feeding
// the channel.
//
// Range / resume support is forward-looking — v1 ignores `Range:`.
package export

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// Source is the row producer. Sending stops when the channel is closed
// by the producer or the request context fires (the producer is
// expected to honour ctx).
//
// Each map key becomes a CSV column header (in the order supplied by
// `columns` in WriteCSV) or a JSON field (whatever the source emits).
type Source <-chan map[string]any

// WriteCSV streams rows as CSV with a header row of `columns`.
// Filename suggestion is supplied via Content-Disposition.
//
// Values are stringified with toString — strings are emitted verbatim,
// integers/floats use strconv, time.Time uses RFC3339Nano, anything
// else uses fmt.Sprint.
func WriteCSV(w http.ResponseWriter, r *http.Request, filename string, columns []string, src Source) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	cw := csv.NewWriter(w)
	if err := cw.Write(columns); err != nil {
		return fmt.Errorf("export: write csv header: %w", err)
	}
	cw.Flush()
	if flusher != nil {
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return r.Context().Err()
		case row, ok := <-src:
			if !ok {
				cw.Flush()
				if flusher != nil {
					flusher.Flush()
				}
				return cw.Error()
			}
			fields := make([]string, len(columns))
			for i, col := range columns {
				fields[i] = toString(row[col])
			}
			if err := cw.Write(fields); err != nil {
				return fmt.Errorf("export: write csv row: %w", err)
			}
			cw.Flush()
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

// WriteJSONL streams rows as newline-delimited JSON. Each map is
// encoded compactly on one line followed by `\n`.
func WriteJSONL(w http.ResponseWriter, r *http.Request, filename string, src Source) error {
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)

	for {
		select {
		case <-r.Context().Done():
			return r.Context().Err()
		case row, ok := <-src:
			if !ok {
				if flusher != nil {
					flusher.Flush()
				}
				return nil
			}
			if err := enc.Encode(row); err != nil {
				return fmt.Errorf("export: encode jsonl row: %w", err)
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

// FromSlice returns a Source that yields each element of `rows` then
// closes. Useful for small fixed result sets and for tests; production
// callers stream from a database cursor.
func FromSlice(ctx context.Context, rows []map[string]any) Source {
	out := make(chan map[string]any, len(rows))
	go func() {
		defer close(out)
		for _, row := range rows {
			select {
			case <-ctx.Done():
				return
			case out <- row:
			}
		}
	}()
	return out
}

func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(x)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case uint:
		return strconv.FormatUint(uint64(x), 10)
	case uint32:
		return strconv.FormatUint(uint64(x), 10)
	case uint64:
		return strconv.FormatUint(x, 10)
	case float32:
		return strconv.FormatFloat(float64(x), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case time.Time:
		return x.UTC().Format(time.RFC3339Nano)
	default:
		return fmt.Sprint(v)
	}
}
