package price

import (
	"net"
	"net/http"
	"time"
)

// newHTTPClient returns a sensibly-configured http.Client for outbound calls
// to third-party price feeds. Short per-request timeout, aggressive idle
// connection reuse, and a per-host connection cap so a slow provider can't
// starve the rest of the program.
func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   4 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:        20,
			MaxIdleConnsPerHost: 10,
			MaxConnsPerHost:     10,
			IdleConnTimeout:     60 * time.Second,
			TLSHandshakeTimeout: 4 * time.Second,
		},
	}
}

// userAgent is what we send on outbound requests — some providers (Yahoo)
// 403 requests without a "real" UA.
const userAgent = "stockapp/0.1 (+https://github.com/stockapp)"
