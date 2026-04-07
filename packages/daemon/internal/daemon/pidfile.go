package daemon

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// WritePIDFile writes the current process ID to the given path.
func WritePIDFile(path string) error {
	return os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0644)
}

// ReadPIDFile reads a PID from the given file.
func ReadPIDFile(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read pid file: %w", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, fmt.Errorf("parse pid: %w", err)
	}
	return pid, nil
}

// RemovePIDFile removes the PID file.
func RemovePIDFile(path string) error {
	return os.Remove(path)
}

// IsProcessRunning checks if a process with the given PID is still alive.
func IsProcessRunning(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// Signal 0 checks if the process exists without actually sending a signal.
	return proc.Signal(syscall.Signal(0)) == nil
}
