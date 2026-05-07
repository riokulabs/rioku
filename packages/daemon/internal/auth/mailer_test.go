package auth_test

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
)

// captureSMTP is a minimal SMTP listener that speaks just enough of the
// protocol for net/smtp.SendMail to complete: 220 greeting, 250 to EHLO,
// 250 to MAIL FROM / RCPT TO / DATA, 354 to DATA, 250 to dot, 221 to QUIT.
type captureSMTP struct {
	addr     string
	listener net.Listener
	captured []string
}

func startCaptureSMTP(t *testing.T) *captureSMTP {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	c := &captureSMTP{addr: l.Addr().String(), listener: l}
	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go handleSMTPConn(conn, c)
		}
	}()
	t.Cleanup(func() { l.Close() })
	return c
}

func handleSMTPConn(conn net.Conn, c *captureSMTP) {
	defer conn.Close()
	w := bufio.NewWriter(conn)
	r := bufio.NewReader(conn)

	// Greeting
	_, _ = fmt.Fprintf(w, "220 localhost SMTP ready\r\n")
	_ = w.Flush()

	var body strings.Builder
	inData := false

	for {
		line, err := r.ReadString('\n')
		if err != nil {
			break
		}
		line = strings.TrimRight(line, "\r\n")

		if inData {
			if line == "." {
				inData = false
				c.captured = append(c.captured, body.String())
				_, _ = fmt.Fprintf(w, "250 OK\r\n")
				_ = w.Flush()
			} else {
				body.WriteString(line)
				body.WriteString("\n")
			}
			continue
		}

		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO") || strings.HasPrefix(upper, "HELO"):
			_, _ = fmt.Fprintf(w, "250-localhost\r\n250 OK\r\n")
		case strings.HasPrefix(upper, "MAIL FROM"):
			_, _ = fmt.Fprintf(w, "250 OK\r\n")
		case strings.HasPrefix(upper, "RCPT TO"):
			_, _ = fmt.Fprintf(w, "250 OK\r\n")
		case upper == "DATA":
			_, _ = fmt.Fprintf(w, "354 Start input\r\n")
			inData = true
			body.Reset()
		case strings.HasPrefix(upper, "QUIT"):
			_, _ = fmt.Fprintf(w, "221 Bye\r\n")
			_ = w.Flush()
			return
		default:
			_, _ = fmt.Fprintf(w, "502 Not implemented\r\n")
		}
		_ = w.Flush()
	}
}

// mustParsePort extracts the port number from a "host:port" address string.
func mustParsePort(addr string) int {
	_, portStr, _ := net.SplitHostPort(addr)
	n := 0
	for _, c := range portStr {
		n = n*10 + int(c-'0')
	}
	return n
}

func TestSMTPMailer_sends_to_configured_host(t *testing.T) {
	srv := startCaptureSMTP(t)
	host, _, _ := net.SplitHostPort(srv.addr)
	cfg := auth.MailerConfig{
		Host:     host,
		Port:     mustParsePort(srv.addr),
		From:     "noreply@rioku.local",
		StartTLS: false,
	}
	m := auth.NewSMTPMailer(cfg)
	err := m.Send(context.Background(), auth.MailMessage{
		To:      "user@example.com",
		Subject: "Test",
		Body:    "hello",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if len(srv.captured) == 0 {
		t.Fatal("no mail captured by SMTP server")
	}
}

func TestNopMailer_always_succeeds(t *testing.T) {
	m := auth.NewNopMailer()
	err := m.Send(context.Background(), auth.MailMessage{
		To:      "anyone@example.com",
		Subject: "ignored",
		Body:    "discarded",
	})
	if err != nil {
		t.Fatalf("NopMailer.Send: %v", err)
	}
}
