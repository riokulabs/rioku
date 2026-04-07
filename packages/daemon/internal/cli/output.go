package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"gopkg.in/yaml.v3"
)

// printOutput formats and prints data according to the --output flag.
func printOutput(data any) error {
	switch flagOutput {
	case "json":
		return printJSON(data)
	case "yaml":
		return printYAML(data)
	case "text":
		// Text mode needs explicit rows — caller should use printRows instead.
		return printJSON(data) // fallback
	default:
		return printJSON(data) // table requires explicit rows
	}
}

// printJSON outputs data as pretty-printed JSON.
func printJSON(data any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}

// printYAML outputs data as YAML.
func printYAML(data any) error {
	enc := yaml.NewEncoder(os.Stdout)
	enc.SetIndent(2)
	defer enc.Close()
	return enc.Encode(data)
}

// printTable outputs aligned columns with headers.
func printTable(headers []string, rows [][]string) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, strings.Join(headers, "\t"))
	for _, row := range rows {
		fmt.Fprintln(w, strings.Join(row, "\t"))
	}
	w.Flush()
}

// printText outputs tab-separated values (one record per line, no headers).
func printText(rows [][]string) {
	for _, row := range rows {
		fmt.Println(strings.Join(row, "\t"))
	}
}

// printRows dispatches rows to table or text format based on --output flag.
// For json/yaml, falls back to printing the raw data.
func printRows(headers []string, rows [][]string, rawData any) error {
	switch flagOutput {
	case "json":
		return printJSON(rawData)
	case "yaml":
		return printYAML(rawData)
	case "text":
		printText(rows)
		return nil
	default: // table
		printTable(headers, rows)
		return nil
	}
}

// printSingle prints a single resource in the appropriate format.
// For table mode, prints key-value pairs.
func printSingle(fields map[string]string, rawData any) error {
	switch flagOutput {
	case "json":
		return printJSON(rawData)
	case "yaml":
		return printYAML(rawData)
	case "text":
		for _, v := range fields {
			fmt.Println(v)
		}
		return nil
	default: // table
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		for k, v := range fields {
			fmt.Fprintf(w, "%s:\t%s\n", k, v)
		}
		w.Flush()
		return nil
	}
}

// truncate shortens a string to max length with ellipsis.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
