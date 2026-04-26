// cmd/upstox-login runs the Upstox OAuth dance once and prints the resulting
// access token. Upstox tokens expire every day at ~3:30 AM IST, so the daily
// flow is:
//
//	stop the API server (Ctrl-C)         # the redirect URL listens on 8080
//	cd backend && go run ./cmd/upstox-login
//	# browser opens, log into Upstox, approve
//	# this CLI prints:  UPSTOX_ACCESS_TOKEN=eyJ...
//	# paste that into .env, restart server + worker
//
// The CLI starts a local HTTP listener on whatever port the configured
// UPSTOX_REDIRECT_URL points at, opens the browser to Upstox's authorization
// dialog, waits for the redirect with ?code=..., exchanges the code for a
// bearer token, and prints it.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/stockapp/backend/internal/config"
)

const (
	upstoxAuthURL  = "https://api.upstox.com/v2/login/authorization/dialog"
	upstoxTokenURL = "https://api.upstox.com/v2/login/authorization/token"
)

type tokenResp struct {
	AccessToken string   `json:"access_token"`
	Email       string   `json:"email"`
	UserName    string   `json:"user_name"`
	UserID      string   `json:"user_id"`
	Broker      string   `json:"broker"`
	IsActive    bool     `json:"is_active"`
	Exchanges   []string `json:"exchanges"`
	// Upstox returns errors as: {"error":{"code":"...","message":"..."}}
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "upstox-login:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Upstox.APIKey == "" || cfg.Upstox.APISecret == "" {
		return errors.New("UPSTOX_API_KEY and UPSTOX_API_SECRET must be set in .env")
	}
	if cfg.Upstox.RedirectURL == "" {
		return errors.New("UPSTOX_REDIRECT_URL must be set in .env")
	}

	redirectURL, err := url.Parse(cfg.Upstox.RedirectURL)
	if err != nil {
		return fmt.Errorf("UPSTOX_REDIRECT_URL: %w", err)
	}
	host := redirectURL.Hostname()
	port := redirectURL.Port()
	if port == "" {
		port = "80"
	}
	if host != "localhost" && host != "127.0.0.1" {
		fmt.Fprintln(os.Stderr,
			"warning: UPSTOX_REDIRECT_URL host is", host,
			"— this CLI binds to localhost; the OAuth callback will not reach us.")
	}

	// Listen on all interfaces (empty host) so localhost / 127.0.0.1 / ::1
	// all reach us regardless of how the browser resolves "localhost".
	listenAddr := net.JoinHostPort("", port)
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return fmt.Errorf(
			"can't listen on %s: %w (is the API server still running? stop it first)",
			listenAddr, err)
	}

	// Build the auth URL, push the user to it.
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", cfg.Upstox.APIKey)
	q.Set("redirect_uri", cfg.Upstox.RedirectURL)
	q.Set("state", "stockapp-cli")
	authURL := upstoxAuthURL + "?" + q.Encode()

	fmt.Println()
	fmt.Println("Opening Upstox login in your browser…")
	fmt.Println("If it doesn't open, paste this into a browser tab:")
	fmt.Println()
	fmt.Println("    " + authURL)
	fmt.Println()
	fmt.Printf("Listening on %s for the OAuth callback…\n", listenAddr)
	fmt.Println("(Press Ctrl-C to abort.)")
	fmt.Println()

	go func() {
		if err := openBrowser(authURL); err != nil {
			fmt.Fprintln(os.Stderr, "could not auto-open browser:", err)
		}
	}()

	// Listen for the callback. Result lands on this channel.
	type result struct {
		code string
		err  error
	}
	resultCh := make(chan result, 1)

	mux := http.NewServeMux()
	// Catch-all: accept the callback at any path. Avoids a 404 if the
	// redirect URL registered at Upstox doesn't exactly match the path in
	// .env (trailing slash, different prefix, etc.) — we just need the
	// `code` query param.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("→ %s %s\n", r.Method, r.URL.RequestURI())

		code := r.URL.Query().Get("code")
		errParam := r.URL.Query().Get("error")
		errDesc := r.URL.Query().Get("error_description")

		if code == "" && errParam == "" {
			// Some other request (favicon, browser probe, etc.). Don't
			// resolve the result channel — keep waiting for the real one.
			http.Error(w, "Waiting for OAuth callback…", http.StatusNotFound)
			return
		}
		if errParam != "" {
			msg := "Authorization failed."
			if errDesc != "" {
				msg = errDesc
			}
			http.Error(w, msg, http.StatusBadRequest)
			resultCh <- result{err: fmt.Errorf("upstox returned: %s — %s", errParam, errDesc)}
			return
		}
		fmt.Fprint(w, callbackHTML)
		resultCh <- result{code: code}
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		_ = srv.Serve(ln)
	}()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	var code string
	select {
	case <-ctx.Done():
		_ = srv.Close()
		return errors.New("aborted")
	case res := <-resultCh:
		_ = srv.Close()
		if res.err != nil {
			return res.err
		}
		code = res.code
	case <-time.After(5 * time.Minute):
		_ = srv.Close()
		return errors.New("timed out waiting for OAuth callback after 5 minutes")
	}

	fmt.Println("Authorization code received. Exchanging for access token…")
	tok, err := exchangeCode(ctx, cfg.Upstox, code)
	if err != nil {
		return err
	}

	fmt.Println()
	fmt.Println("Success! Logged in as", tok.UserName, "("+tok.Email+")")
	fmt.Println()
	fmt.Println("──────────────────────────────────────────────────")
	fmt.Println("Paste this line into your .env (replace the existing UPSTOX_ACCESS_TOKEN=…):")
	fmt.Println()
	fmt.Println("UPSTOX_ACCESS_TOKEN=" + tok.AccessToken)
	fmt.Println("──────────────────────────────────────────────────")
	fmt.Println()
	fmt.Println("Then restart the API server and price worker. The token will work")
	fmt.Println("until ~3:30 AM IST tomorrow, then re-run this command.")
	return nil
}

// exchangeCode does the POST /token call with the auth code we received.
func exchangeCode(ctx context.Context, u config.Upstox, code string) (*tokenResp, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", u.APIKey)
	form.Set("client_secret", u.APISecret)
	form.Set("redirect_uri", u.RedirectURL)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstoxTokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Api-Version", "2.0")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	var parsed tokenResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("upstox: %s — %s", parsed.Error.Code, parsed.Error.Message)
	}
	if parsed.AccessToken == "" {
		return nil, fmt.Errorf("upstox returned empty access_token (status %s)", resp.Status)
	}
	return &parsed, nil
}

// openBrowser tries the platform-appropriate command to launch a URL. Best-
// effort: callers should print the URL too in case this fails.
func openBrowser(target string) error {
	switch runtime.GOOS {
	case "windows":
		// `rundll32 url.dll` avoids cmd.exe interpreting & in the URL.
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", target).Start()
	case "darwin":
		return exec.Command("open", target).Start()
	default: // linux, freebsd, openbsd, netbsd, etc.
		return exec.Command("xdg-open", target).Start()
	}
}

// callbackHTML is the page Upstox redirects the user back to.
const callbackHTML = `<!doctype html>
<html><head><title>Stockapp · Upstox login</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f17;color:#cbd5e1;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{max-width:420px;padding:32px;border:1px solid #1c2431;border-radius:16px;background:#141b26}
  h1{margin:0 0 8px 0;font-size:18px;color:#e5e7eb}
  p{margin:0;font-size:14px;line-height:1.5}
  .ok{color:#10b981;font-weight:600}
</style></head>
<body><div class="card">
  <h1><span class="ok">✓</span> Logged in to Upstox</h1>
  <p>You can close this tab and return to your terminal. The access token
     should be printed there now.</p>
</div></body></html>`
