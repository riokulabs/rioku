package auth

import (
	"context"
	"fmt"
	"net/smtp"
)

type smtpMailer struct {
	cfg MailerConfig
}

// NewSMTPMailer returns a Mailer backed by net/smtp. If cfg.Username is
// non-empty, PLAIN auth is used; otherwise the connection is unauthenticated
// (appropriate for local mailpit/relay).
func NewSMTPMailer(cfg MailerConfig) Mailer {
	return &smtpMailer{cfg: cfg}
}

func (s *smtpMailer) Send(_ context.Context, msg MailMessage) error {
	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	body := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		s.cfg.From, msg.To, msg.Subject, msg.Body)

	var a smtp.Auth
	if s.cfg.Username != "" {
		a = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	}
	return smtp.SendMail(addr, a, s.cfg.From, []string{msg.To}, []byte(body))
}
