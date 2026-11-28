// Package server はブラウザ向けの/apiと静的ファイルを提供する。
// CoreはOriginヘッダ付きを拒否するため、ブラウザは必ずこの経路を通る。
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/naatin777/plugumi/apps/web/internal/corerpc"
	"github.com/naatin777/plugumi/apps/web/internal/cores"
)

type Server struct {
	api      huma.API
	manager  *cores.Manager
	store    *cores.Store
	token    string
	static   fs.FS
	hasIndex bool
	calls    *corerpc.Pool
	coreHTTP *http.Client
	// webDirは~/.plugumi/web。Project保存は<Core名>.json単位。
	webDir    string
	documents sync.Mutex
}

// New はstaticにfrontend distを取る（build済みならindex.htmlを含む）。
func New(manager *cores.Manager, store *cores.Store, token string, static fs.FS, webDir string) *Server {
	// .webmanifestはmimeデータベース未登録の環境があるため明示する。
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_, err := fs.Stat(static, "index.html")
	return &Server{
		manager: manager, store: store, token: token, static: static, hasIndex: err == nil,
		calls: corerpc.NewPool(token), coreHTTP: &http.Client{Timeout: 10 * time.Second},
		webDir: webDir,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.newHumaAPI(mux)
	// /ui/はCoreのUI配信の中継。SPAフォールバックより先に評価される。
	mux.HandleFunc("GET /ui/{key}/{registrationId}/{path...}", s.uiAsset)
	// 未定義の/api配下は静的ファイルではなくJSONの404を返す。
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "unknown endpoint")
	})
	mux.HandleFunc("/", s.staticFile)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorBody(message))
}

// probeClient はCore疎通用の短命クライアント。
func (s *Server) probeClient() *http.Client {
	return &http.Client{Timeout: 5 * time.Second}
}

// staticFile はfrontendの静的ファイルを返す。配信自体は標準のServeFileFSに
// 任せ、拡張子なしで見つからないパスだけindex.htmlにフォールバックする（SPA）。
// dist未ビルドなら案内テキストを返す。
func (s *Server) staticFile(w http.ResponseWriter, r *http.Request) {
	if !s.hasIndex {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = fmt.Fprintln(w, "frontend が未ビルドです（pnpm --dir apps/web/frontend build）")
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if stat, err := fs.Stat(s.static, name); err != nil || stat.IsDir() {
		// 拡張子付きのパスは実ファイル前提なので404。SPAのパスだけindex.htmlへ。
		if path.Ext(name) != "" {
			http.NotFound(w, r)
			return
		}
		name = "index.html"
	}
	// index.htmlは毎回再検証させる（embedにはLast-Modifiedが無く、ヘッダ未指定だと
	// ブラウザが古いHTMLを使い回すことがある）。assets以下はコンテンツハッシュ入りの
	// ファイル名なので長期キャッシュしてよい。
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFileFS(w, r, s.static, name)
}

// coreByKey はURLの先頭に使うkeyからCoreを引く。登録がなければ404を書く。
func (s *Server) coreByKey(w http.ResponseWriter, r *http.Request) (cores.Core, bool) {
	core, found := s.manager.FindByKey(r.PathValue("key"))
	if !found {
		writeError(w, http.StatusNotFound, "no such Core")
	}
	return core, found
}

// panelEntry は/api/cores/{key}/panelsの1要素。Registryの登録ごとの
// panelsを平らにして返す。
type panelEntry struct {
	RegistrationID string   `json:"registrationId"`
	ProviderID     string   `json:"providerId"`
	PanelID        string   `json:"panelId"`
	Title          string   `json:"title"`
	Entry          string   `json:"entry"`
	Styles         []string `json:"styles"`
	UISHA256       string   `json:"uiSha256"`
	RPCAvailable   bool     `json:"rpcAvailable"`
}

// uiAsset はGET /ui/{key}/{registrationId}/{path...}をCoreのGET /v1/uiへ中継する。
// CoreがOriginヘッダ付きを拒否するため、ブラウザからはこの経路でしか取れない。
func (s *Server) uiAsset(w http.ResponseWriter, r *http.Request) {
	core, found := s.coreByKey(w, r)
	if !found {
		return
	}
	upstream := core.URL + "/v1/ui/" + r.PathValue("registrationId") + "/" + r.PathValue("path")
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if s.token != "" {
		request.Header.Set("Authorization", "Bearer "+s.token)
	}
	response, err := s.coreHTTP.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Core at %s is unreachable: %v", core.URL, err))
		return
	}
	defer response.Body.Close()
	for _, header := range []string{"Content-Type", "ETag"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

// --- Project/Area/Workspace（~/.plugumi/web/<Core名>.json） ---

func errorBody(message string) map[string]any {
	return map[string]any{"error": map[string]any{"message": message}}
}
