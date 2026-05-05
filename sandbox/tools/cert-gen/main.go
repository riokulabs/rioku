package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	OutDir        string
	CACommonName  string
	LeafSubjects  []string
	ValidityHours int
	Force         bool
}

func main() {
	out := flag.String("out", "sandbox/.data/certs", "output directory")
	caCN := flag.String("ca-cn", "Rioku Sandbox CA", "CA common name")
	subjects := flag.String("subjects", "localhost,*.localhost,*.tenant.localhost", "comma-separated DNS names + IPs for leaf cert")
	hours := flag.Int("hours", 8760, "leaf cert validity in hours")
	force := flag.Bool("force", false, "overwrite existing certs")
	flag.Parse()

	cfg := Config{
		OutDir:        *out,
		CACommonName:  *caCN,
		LeafSubjects:  splitTrim(*subjects, ","),
		ValidityHours: *hours,
		Force:         *force,
	}
	if err := Run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "cert-gen: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("certs written to %s\n", cfg.OutDir)
}

func splitTrim(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		t := strings.TrimSpace(p)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func Run(cfg Config) error {
	if err := os.MkdirAll(cfg.OutDir, 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}

	caCertPath := filepath.Join(cfg.OutDir, "ca.pem")
	if _, err := os.Stat(caCertPath); err == nil && !cfg.Force {
		return errors.New("certs already exist; pass --force to overwrite")
	}

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("ca key: %w", err)
	}
	caTpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cfg.CACommonName},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Duration(cfg.ValidityHours*10) * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("create ca cert: %w", err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return fmt.Errorf("parse ca cert: %w", err)
	}
	if err := writePEMCert(caCertPath, caDER); err != nil {
		return err
	}
	if err := writePEMECKey(filepath.Join(cfg.OutDir, "ca-key.pem"), caKey); err != nil {
		return err
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fmt.Errorf("leaf key: %w", err)
	}
	dnsNames, ipAddrs := splitDNSAndIP(cfg.LeafSubjects)
	leafTpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: dnsNames[0]},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Duration(cfg.ValidityHours) * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     dnsNames,
		IPAddresses:  ipAddrs,
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		return fmt.Errorf("create leaf cert: %w", err)
	}
	if err := writePEMCert(filepath.Join(cfg.OutDir, "leaf.pem"), leafDER); err != nil {
		return err
	}
	if err := writePEMECKey(filepath.Join(cfg.OutDir, "leaf-key.pem"), leafKey); err != nil {
		return err
	}
	return nil
}

func splitDNSAndIP(subjects []string) ([]string, []net.IP) {
	dns := []string{}
	ips := []net.IP{}
	for _, s := range subjects {
		if ip := net.ParseIP(s); ip != nil {
			ips = append(ips, ip)
		} else {
			dns = append(dns, s)
		}
	}
	return dns, ips
}

func writePEMCert(path string, der []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	return pem.Encode(f, &pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func writePEMECKey(path string, key *ecdsa.PrivateKey) error {
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	return pem.Encode(f, &pem.Block{Type: "EC PRIVATE KEY", Bytes: der})
}
