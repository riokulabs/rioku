package caddy

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/riokulabs/rioku/internal/version"
)

// DownloadBinary downloads the Caddy binary for the current platform
// to the specified directory. Returns the path to the downloaded binary.
func DownloadBinary(destDir string, progress func(downloaded, total int64)) (string, error) {
	if err := os.MkdirAll(destDir, 0750); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}

	destPath := filepath.Join(destDir, "caddy")
	goos := runtime.GOOS
	goarch := runtime.GOARCH

	url := fmt.Sprintf("https://caddyserver.com/api/download?os=%s&arch=%s", goos, goarch)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", fmt.Sprintf("Rioku/%s (github.com/riokulabs/rioku)", version.Version))

	downloadClient := &http.Client{Timeout: 5 * time.Minute} // Caddy binary is ~50MB
	resp, err := downloadClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download caddy: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("caddy download returned %d: %s", resp.StatusCode, string(body))
	}

	tmpPath := destPath + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return "", fmt.Errorf("create temp file: %w", err)
	}

	var reader io.Reader = resp.Body
	if progress != nil {
		reader = &progressReader{
			reader:   resp.Body,
			total:    resp.ContentLength,
			callback: progress,
		}
	}

	if _, err := io.Copy(f, reader); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("write caddy binary: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("close caddy binary: %w", err)
	}

	// Atomic rename.
	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("rename caddy binary: %w", err)
	}

	return destPath, nil
}

// FindBinary looks for a Caddy binary in standard locations.
// Returns the path if found, empty string if not.
func FindBinary(dataDir string) string {
	// Check data_dir/bin/caddy first.
	localPath := filepath.Join(dataDir, "bin", "caddy")
	if _, err := os.Stat(localPath); err == nil {
		return localPath
	}

	// Check PATH.
	if path, err := LookPath("caddy"); err == nil {
		return path
	}

	return ""
}

// LookPath wraps exec.LookPath for testability.
var LookPath = execLookPath

func execLookPath(name string) (string, error) {
	return filepath.Abs(name)
}

func init() {
	// Use the real exec.LookPath at runtime.
	LookPath = func(name string) (string, error) {
		path, err := filepath.Abs(name)
		if err != nil {
			return "", err
		}
		if _, statErr := os.Stat(path); statErr == nil {
			return path, nil
		}
		// Fall back to searching PATH.
		for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
			full := filepath.Join(dir, name)
			if _, statErr := os.Stat(full); statErr == nil {
				return full, nil
			}
		}
		return "", fmt.Errorf("%s: not found in PATH", name)
	}
}

// progressReader wraps a reader and reports download progress.
type progressReader struct {
	reader     io.Reader
	total      int64
	downloaded int64
	callback   func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.downloaded += int64(n)
	if pr.callback != nil {
		pr.callback(pr.downloaded, pr.total)
	}
	return n, err
}
