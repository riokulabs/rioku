package auth

import "context"

// MailMessage is a minimal outbound email payload.
type MailMessage struct {
	To      string
	Subject string
	Body    string
}

// Mailer is the interface for sending transactional email.
type Mailer interface {
	Send(ctx context.Context, msg MailMessage) error
}

// MailerConfig holds SMTP connection parameters.
type MailerConfig struct {
	Host     string
	Port     int
	From     string
	Username string
	Password string
	StartTLS bool
}

// nopMailer silently drops all mail — used when SMTP is unconfigured.
type nopMailer struct{}

func (nopMailer) Send(_ context.Context, _ MailMessage) error { return nil }

// NewNopMailer returns a Mailer that discards all messages. Use in tests or
// when SMTP is not configured.
func NewNopMailer() Mailer { return nopMailer{} }

// ErrSMTPNotConfigured is returned by handlers that require SMTP when the
// daemon has no SMTP host configured.
type ErrSMTPNotConfigured struct{}

func (ErrSMTPNotConfigured) Error() string { return "SMTP not configured" }
