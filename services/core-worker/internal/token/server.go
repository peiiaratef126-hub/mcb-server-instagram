package token

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type Server struct {
	service *Service
	httpSrv *http.Server
}

func NewServer(service *Service, addr string) *Server {
	s := &Server{
		service: service,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /internal/token", s.handleGetToken)
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	s.httpSrv = &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	return s
}

func (s *Server) Start() error {
	if err := s.httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpSrv.Shutdown(ctx)
}

func (s *Server) handleGetToken(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	token, err := s.service.GetActiveToken(ctx)
	if err != nil {
		if errors.Is(err, ErrNoActiveToken) {
			http.Error(w, `{"error":"no_active_token"}`, http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrTokenExpired) {
			http.Error(w, `{"error":"token_expired"}`, http.StatusGone)
			return
		}
		http.Error(w, `{"error":"internal_token_error"}`, http.StatusInternalServerError)
		return
	}

	meta, _ := s.service.GetTokenMetadata(ctx)
	var expiresAt *time.Time
	if meta != nil {
		expiresAt = meta.ExpiresAt
	}

	resp := TokenResponse{
		AccountID:   s.service.cfg.AccountID,
		AccessToken: token,
		ExpiresAt:   expiresAt,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}
