// Command rioku-caddy is the bundled Caddy binary that ships with
// Rioku. It is a thin wrapper around the upstream Caddy main package
// that imports every first-party Rioku plugin so they register at
// init() time. The daemon launches this binary as the traffic engine.
//
// Adding a new first-party plugin is a single-line change here: add
// the module's import below. xcaddy is not required — `go build`
// against this main package produces the bundled binary.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// Import standard Caddy modules — same set the upstream
	// `caddy` binary ships with. The blank import is the
	// convention upstream Caddy uses.
	_ "github.com/caddyserver/caddy/v2/modules/standard"

	// First-party Rioku plugins. Each module registers itself in
	// its init() function, so blank-importing is sufficient.
	_ "github.com/riokulabs/rioku/plugins/auth-apikey"
	_ "github.com/riokulabs/rioku/plugins/auth-jwt"
	_ "github.com/riokulabs/rioku/plugins/auth-oidc"
	_ "github.com/riokulabs/rioku/plugins/canary"
	_ "github.com/riokulabs/rioku/plugins/circuit-breaker"
	_ "github.com/riokulabs/rioku/plugins/cors"
	_ "github.com/riokulabs/rioku/plugins/mcp-auth"
	_ "github.com/riokulabs/rioku/plugins/mirror"
	_ "github.com/riokulabs/rioku/plugins/oas-validator"
	_ "github.com/riokulabs/rioku/plugins/rate-limit"
	_ "github.com/riokulabs/rioku/plugins/transform"

	// Coraza WAF (#172, #204). Registers http.handlers.waf so the
	// Caddy compiler can emit Coraza directives from per-route WAF
	// configs. coreruleset is bundled separately so operators can
	// opt into OWASP CRS without downloading rule files at runtime.
	_ "github.com/corazawaf/coraza-caddy/v2"
	_ "github.com/corazawaf/coraza-coreruleset/v4"
)

func main() {
	caddycmd.Main()
}
