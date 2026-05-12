#!/bin/sh
# _progress.sh — TTY-aware progress spinner for slow Makefile targets.
#
# Usage (source this file, then call the functions):
#   . scripts/_progress.sh
#   progress_start "Building daemon"
#   <long command>
#   progress_done
#
# Behavior:
#   - On a real TTY with a capable TERM: animated spinner + elapsed time.
#   - On non-TTY / TERM=dumb (CI, piped output): plain "==> <label>..." line,
#     no spinner, no ANSI codes. Graceful degrade, zero side effects.
#
# POSIX sh — no bashisms.

# ── color setup ──────────────────────────────────────────────────────────────
_progress_tty=0
_progress_bold=""
_progress_cyan=""
_progress_green=""
_progress_reset=""

if [ -t 1 ] && [ "${TERM:-dumb}" != "dumb" ] && command -v tput >/dev/null 2>&1; then
    _progress_tty=1
    _progress_bold=$(tput bold 2>/dev/null || printf "")
    _progress_cyan=$(tput setaf 6 2>/dev/null || printf "")
    _progress_green=$(tput setaf 2 2>/dev/null || printf "")
    _progress_reset=$(tput sgr0 2>/dev/null || printf "")
fi

# ── internal state ────────────────────────────────────────────────────────────
_progress_pid=""
_progress_label=""
_progress_start_ts=""

# ── _progress_spinner (background loop) ──────────────────────────────────────
# Runs as a separate process; writes to fd 1 of the calling shell.
# Called only when _progress_tty=1.
_progress_spinner() {
    label="$1"
    frames=". .. ..."
    i=0
    while true; do
        elapsed=$(( $(date +%s) - _progress_start_ts ))
        case $(( i % 3 )) in
            0) f="." ;;
            1) f=".." ;;
            2) f="..." ;;
        esac
        printf "\r%s==> %s%s %s%-3s  %ds%s" \
            "${_progress_bold}${_progress_cyan}" \
            "${label}" \
            "${_progress_reset}" \
            "${_progress_cyan}" \
            "${f}" \
            "${elapsed}" \
            "${_progress_reset}"
        i=$(( i + 1 ))
        sleep 0.35 2>/dev/null || sleep 1
    done
}

# ── progress_start ────────────────────────────────────────────────────────────
# progress_start "Human-readable label"
progress_start() {
    _progress_label="$1"
    _progress_start_ts=$(date +%s)

    if [ "$_progress_tty" = "1" ]; then
        # Export vars needed by the background subshell.
        export _progress_start_ts _progress_bold _progress_cyan _progress_reset
        _progress_spinner "$_progress_label" &
        _progress_pid=$!
    else
        printf "==> %s...\n" "$_progress_label"
    fi
}

# ── progress_done ─────────────────────────────────────────────────────────────
# Call after the slow command finishes (regardless of exit code).
progress_done() {
    if [ "$_progress_tty" = "1" ] && [ -n "$_progress_pid" ]; then
        kill "$_progress_pid" 2>/dev/null
        wait "$_progress_pid" 2>/dev/null
        _progress_pid=""
        elapsed=$(( $(date +%s) - _progress_start_ts ))
        printf "\r%s[done]%s  %s  (%ds)%*s\n" \
            "${_progress_green}${_progress_bold}" \
            "${_progress_reset}" \
            "$_progress_label" \
            "$elapsed" \
            "10" ""
    fi
    _progress_label=""
    _progress_start_ts=""
}
