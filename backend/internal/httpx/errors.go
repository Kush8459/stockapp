package httpx

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/rs/zerolog/log"
)

// APIError is the canonical error type returned to clients.
type APIError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string { return e.Message }

func NewError(status int, code, message string) *APIError {
	return &APIError{Status: status, Code: code, Message: message}
}

// Common sentinel errors used by handlers.
var (
	ErrBadRequest   = &APIError{Status: http.StatusBadRequest, Code: "bad_request", Message: "bad request"}
	ErrUnauthorized = &APIError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "unauthorized"}
	ErrForbidden    = &APIError{Status: http.StatusForbidden, Code: "forbidden", Message: "forbidden"}
	ErrNotFound     = &APIError{Status: http.StatusNotFound, Code: "not_found", Message: "not found"}
	ErrConflict     = &APIError{Status: http.StatusConflict, Code: "conflict", Message: "conflict"}
	ErrInternal     = &APIError{Status: http.StatusInternalServerError, Code: "internal", Message: "internal error"}
)

// JSON writes v as JSON with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error().Err(err).Msg("encode response")
	}
}

// Error serialises err to the client. Non-APIError values are logged and
// surface as 500s with a generic message.
func Error(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		JSON(w, apiErr.Status, apiErr)
		return
	}
	log.Error().Err(err).Str("path", r.URL.Path).Msg("unhandled error")
	JSON(w, http.StatusInternalServerError, ErrInternal)
}

// Decode parses a JSON body into dst. Returns ErrBadRequest on failure.
func Decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return NewError(http.StatusBadRequest, "bad_json", "invalid request body")
	}
	return nil
}
