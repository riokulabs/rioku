package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// EmailChannelConfig is the per-channel JSON payload stored in
// notification_channels.config when kind == "email".
//
// Either an explicit SMTP server (Host + Port) or a tenant-default
// relay path (host = "" -> use process default in TestMailerHook) is
// supported. From + To are required; subject template is optional.
type EmailChannelConfig struct {
	// Recipients (RFC5322 mailboxes).
	To []string `json:"to"`

	// From mailbox. Required.
	From string `json:"from"`

	// SMTP relay host:port. If empty, the process-level default
	// (env RIOKU_SMTP_ADDR or sandbox mailpit at localhost:1025)
	// is used.
	Host string `json:"host,omitempty"`
	Port int    `json:"port,omitempty"`

	// AuthUser / AuthPass enable plain SMTP auth when non-empty.
	AuthUser string `json:"authUser,omitempty"`
	AuthPass string `json:"authPass,omitempty"`

	// SubjectPrefix is prepended to every Message.Subject. Useful
	// for tagging (e.g. "[Rioku-staging] ").
	SubjectPrefix string `json:"subjectPrefix,omitempty"`
}

// SMTPSender is the seam used by EmailChannel so tests can stub the
// network call. The default implementation calls smtp.SendMail.
type SMTPSender func(addr string, auth smtp.Auth, from string, to []string, msg []byte) error

// DefaultSMTPSender is net/smtp.SendMail. Overridable in tests via
// EmailChannel.Sender.
var DefaultSMTPSender SMTPSender = smtp.SendMail

// EmailChannel implements Channel via SMTP.
type EmailChannel struct {
	Config EmailChannelConfig

	// Sender lets tests intercept the SMTP call. nil -> DefaultSMTPSender.
	Sender SMTPSender

	// DefaultHost / DefaultPort are the process-level fallback used
	// when Config.Host is empty. Daemon wiring sets these from env.
	DefaultHost string
	DefaultPort int
}

// NewEmailChannel parses the JSON config blob from a stored
// NotificationChannel and returns a ready-to-send EmailChannel.
// Returns ErrPermanent-wrapped error for malformed config.
func NewEmailChannel(configJSON string, defaultHost string, defaultPort int) (*EmailChannel, error) {
	var cfg EmailChannelConfig
	if strings.TrimSpace(configJSON) == "" {
		return nil, ErrorPermanent(errors.New("email channel: empty config"))
	}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, ErrorPermanent(fmt.Errorf("email channel: parse config: %w", err))
	}
	if cfg.From == "" {
		return nil, ErrorPermanent(errors.New("email channel: from is required"))
	}
	if len(cfg.To) == 0 {
		return nil, ErrorPermanent(errors.New("email channel: at least one to address is required"))
	}
	return &EmailChannel{Config: cfg, DefaultHost: defaultHost, DefaultPort: defaultPort}, nil
}

func (c *EmailChannel) Kind() string { return "email" }

// Send composes an RFC5322 message and dials the configured SMTP relay.
// Honours ctx via a goroutine + channel pattern (net/smtp.SendMail itself
// does not accept a context, so we race the call against ctx.Done()).
func (c *EmailChannel) Send(ctx context.Context, msg Message) error {
	host := c.Config.Host
	if host == "" {
		host = c.DefaultHost
	}
	port := c.Config.Port
	if port == 0 {
		port = c.DefaultPort
	}
	if host == "" {
		return ErrorPermanent(errors.New("email channel: no SMTP host configured"))
	}
	if port == 0 {
		port = 25
	}
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))

	subject := c.Config.SubjectPrefix + msg.Subject
	body := buildRFC822(c.Config.From, c.Config.To, subject, msg)

	var auth smtp.Auth
	if c.Config.AuthUser != "" {
		auth = smtp.PlainAuth("", c.Config.AuthUser, c.Config.AuthPass, host)
	}

	sender := c.Sender
	if sender == nil {
		sender = DefaultSMTPSender
	}

	done := make(chan error, 1)
	go func() {
		done <- sender(addr, auth, c.Config.From, c.Config.To, body)
	}()
	select {
	case err := <-done:
		if err == nil {
			return nil
		}
		// Heuristic: SMTP 5xx codes are permanent.
		if isPermanentSMTPErr(err) {
			return ErrorPermanent(err)
		}
		return fmt.Errorf("email send: %w", err)
	case <-ctx.Done():
		return fmt.Errorf("email send: %w", ctx.Err())
	}
}

func buildRFC822(from string, to []string, subject string, msg Message) []byte {
	var b strings.Builder
	b.WriteString("From: ")
	b.WriteString(from)
	b.WriteString("\r\n")
	b.WriteString("To: ")
	b.WriteString(strings.Join(to, ", "))
	b.WriteString("\r\n")
	b.WriteString("Subject: ")
	b.WriteString(strings.ReplaceAll(subject, "\n", " "))
	b.WriteString("\r\n")
	b.WriteString("Date: ")
	b.WriteString(time.Now().UTC().Format(time.RFC1123Z))
	b.WriteString("\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	if msg.Severity != "" {
		b.WriteString("X-Rioku-Severity: ")
		b.WriteString(msg.Severity)
		b.WriteString("\r\n")
	}
	if msg.Kind != "" {
		b.WriteString("X-Rioku-Kind: ")
		b.WriteString(msg.Kind)
		b.WriteString("\r\n")
	}
	b.WriteString("\r\n")
	b.WriteString(msg.Body)
	if len(msg.Metadata) > 0 {
		b.WriteString("\r\n\r\n--\r\nMetadata:\r\n")
		if j, err := json.MarshalIndent(msg.Metadata, "", "  "); err == nil {
			b.Write(j)
		}
	}
	return []byte(b.String())
}

// isPermanentSMTPErr reports whether the SMTP response code embedded
// in err.Error() is a 5xx (permanent) failure. net/smtp returns
// errors of the form "5xx <reason>" for protocol-level failures.
func isPermanentSMTPErr(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	if len(s) < 3 {
		return false
	}
	// Match "5xx " prefix (net/smtp.Error formats this way).
	return s[0] == '5' && s[1] >= '0' && s[1] <= '9' && s[2] >= '0' && s[2] <= '9'
}
