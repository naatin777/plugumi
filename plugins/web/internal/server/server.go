// Package server はブラウザ向けの/apiと静的ファイルを提供する。
// CoreはOriginヘッダ付きを拒否するため、ブラウザは必ずこの経路を通る。
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/naatin777/plugumi/plugins/web/internal/coreclient"
	"github.com/naatin777/plugumi/plugins/web/internal/corerpc"
	"github.com/naatin777/plugumi/plugins/web/internal/cores"
	"github.com/naatin777/plugumi/plugins/web/internal/projects"
)

type Server struct {
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
	mux.HandleFunc("GET /api/cores", s.listCores)
	mux.HandleFunc("POST /api/cores", s.addCore)
	mux.HandleFunc("DELETE /api/cores", s.removeCore)
	mux.HandleFunc("GET /api/cores/{key}", s.getCore)
	mux.HandleFunc("GET /api/cores/{key}/panels", s.listPanels)
	mux.HandleFunc("POST /api/cores/{key}/call", s.callTool)
	mux.HandleFunc("GET /api/cores/{key}/projects", s.listProjects)
	mux.HandleFunc("POST /api/cores/{key}/projects", s.addProject)
	mux.HandleFunc("DELETE /api/cores/{key}/projects/{project}", s.removeProject)
	mux.HandleFunc("POST /api/cores/{key}/projects/{project}/areas", s.addArea)
	mux.HandleFunc("DELETE /api/cores/{key}/projects/{project}/areas/{rest...}", s.removeArea)
	mux.HandleFunc("GET /api/cores/{key}/projects/{project}/pinned", s.getPinned)
	mux.HandleFunc("PUT /api/cores/{key}/projects/{project}/pinned", s.putPinned)
	// workspaceのパスは{rest...}末尾が"workspace"のときだけ扱う
	// （muxのワイルドカードは末尾にしか置けないため）。
	mux.HandleFunc("GET /api/cores/{key}/projects/{project}/areas/{rest...}", s.getWorkspace)
	mux.HandleFunc("PUT /api/cores/{key}/projects/{project}/areas/{rest...}", s.putWorkspace)
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

func (s *Server) listCores(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.manager.List())
}

func (s *Server) getCore(w http.ResponseWriter, r *http.Request) {
	core, found := s.manager.FindByKey(r.PathValue("key"))
	if !found {
		writeError(w, http.StatusNotFound, "no such Core")
		return
	}
	writeJSON(w, http.StatusOK, core)
}

func (s *Server) addCore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "request body must be JSON with a url field")
		return
	}
	normalized, err := cores.NormalizeURL(body.URL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, exists := s.manager.Get(normalized); exists {
		writeError(w, http.StatusConflict, fmt.Sprintf("Core at %s is already registered", normalized))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	info, err := coreclient.FetchCoreInfo(ctx, s.probeClient(), s.token, normalized)
	cancel()
	if err != nil {
		var httpErr *coreclient.StatusError
		if errors.As(err, &httpErr) {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("Core at %s returned %s", normalized, err))
		} else {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("Core at %s is unreachable: %v", normalized, err))
		}
		return
	}
	if info.Name == "" {
		writeError(w, http.StatusBadRequest, "core.name を設定してください")
		return
	}
	if cores.ReservedName(info.Name) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Core name %q is reserved by the web plugin; choose another core.name", info.Name))
		return
	}
	if conflict, taken := s.manager.NameTaken(info.Name, normalized); taken {
		writeError(w, http.StatusConflict, fmt.Sprintf("Core name %q is already used by %s", info.Name, conflict.URL))
		return
	}
	if err := s.manager.Add(normalized, cores.SourceSaved); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.manager.SetInfo(normalized, info)
	if s.store != nil {
		if err := s.store.Add(normalized); err != nil {
			s.manager.Remove(normalized)
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("could not save Core list: %v", err))
			return
		}
	}
	core, _ := s.manager.Get(normalized)
	writeJSON(w, http.StatusCreated, core)
}

func (s *Server) removeCore(w http.ResponseWriter, r *http.Request) {
	normalized, err := cores.NormalizeURL(r.URL.Query().Get("url"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	core, found := s.manager.Get(normalized)
	if !found {
		writeError(w, http.StatusNotFound, "no such Core")
		return
	}
	if core.Source != cores.SourceSaved {
		writeError(w, http.StatusBadRequest, "Cores passed on the command line cannot be removed")
		return
	}
	s.manager.Remove(normalized)
	if s.store != nil {
		if err := s.store.Remove(normalized); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("could not save Core list: %v", err))
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
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
		_, _ = fmt.Fprintln(w, "frontend が未ビルドです（pnpm --dir plugins/web/frontend build）")
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
	PluginID       string   `json:"pluginId"`
	PanelID        string   `json:"panelId"`
	Title          string   `json:"title"`
	Entry          string   `json:"entry"`
	Styles         []string `json:"styles"`
	UISHA256       string   `json:"uiSha256"`
}

func (s *Server) listPanels(w http.ResponseWriter, r *http.Request) {
	core, found := s.coreByKey(w, r)
	if !found {
		return
	}
	snapshot, err := coreclient.FetchRegistry(r.Context(), s.coreHTTP, s.token, core.URL)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("could not read Core registry: %v", err))
		return
	}
	panels := []panelEntry{}
	for _, registration := range snapshot.Registrations {
		for _, panel := range registration.Panels {
			panels = append(panels, panelEntry{
				RegistrationID: registration.RegistrationID, PluginID: registration.PluginID,
				PanelID: panel.PanelID, Title: panel.Title, Entry: panel.Entry,
				Styles: panel.Styles, UISHA256: registration.UISHA256,
			})
		}
	}
	writeJSON(w, http.StatusOK, panels)
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

// callTool は/api/cores/{key}/callを呼び出し専用WS接続のtools.callへ変換する。
// 今回はsync Toolのみ。asyncは実処理が走ったまま終端を取りこぼすため事前に400で止める。
func (s *Server) callTool(w http.ResponseWriter, r *http.Request) {
	core, found := s.coreByKey(w, r)
	if !found {
		return
	}
	var body struct {
		RegistrationID string          `json:"registrationId"`
		ToolPath       string          `json:"toolPath"`
		Input          json.RawMessage `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RegistrationID == "" || body.ToolPath == "" {
		writeError(w, http.StatusBadRequest, "request body must be JSON with registrationId, toolPath and input")
		return
	}
	snapshot, err := coreclient.FetchRegistry(r.Context(), s.coreHTTP, s.token, core.URL)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("could not read Core registry: %v", err))
		return
	}
	for _, registration := range snapshot.Registrations {
		if registration.RegistrationID != body.RegistrationID {
			continue
		}
		for _, tool := range registration.Tools {
			if tool.ToolPath == body.ToolPath && tool.Kind == "async" {
				writeError(w, http.StatusBadRequest, "async Tools are not supported yet")
				return
			}
		}
	}
	result, rpcError, err := s.calls.For(core.URL).Call(r.Context(), body.RegistrationID, body.ToolPath, body.Input)
	if rpcError != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": map[string]any{"message": rpcError.Message, "code": rpcError.Code},
		})
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("could not call Tool: %v", err))
		return
	}
	if len(result) == 0 {
		result = json.RawMessage("null")
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"result":` + string(result) + `}`))
}

// --- Project/Area/Workspace（~/.plugumi/web/<Core名>.json） ---

// projectContext はProject APIの共通下ごしらえ。
// key→Core（name必須、無ければ保存先が決まらないため409）とDocumentを返す。
// 変更系はmutateへDocumentへの操作を書く。成功したら保存まで行う。
func (s *Server) projectContext(w http.ResponseWriter, r *http.Request, mutate func(document *projects.Document) (any, int)) {
	core, found := s.coreByKey(w, r)
	if !found {
		return
	}
	if core.Name == "" {
		writeError(w, http.StatusConflict, "core.name を設定してください")
		return
	}
	s.documents.Lock()
	defer s.documents.Unlock()
	document, err := projects.Load(s.webDir, core.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("could not read projects: %v", err))
		return
	}
	body, status := mutate(document)
	if status >= 400 || !isWriteMethod(r.Method) {
		writeJSON(w, status, body)
		return
	}
	if err := projects.Save(s.webDir, core.Name, document); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("could not save projects: %v", err))
		return
	}
	writeJSON(w, status, body)
}

func isWriteMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodDelete
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		return document.Trees(), http.StatusOK
	})
}

func (s *Server) addProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		switch err := document.AddProject(body.Name); {
		case errors.Is(err, projects.ErrInvalidName):
			return map[string]any{"error": map[string]any{"message": "invalid name"}}, http.StatusBadRequest
		case errors.Is(err, projects.ErrDuplicateName):
			return map[string]any{"error": map[string]any{"message": "name already exists"}}, http.StatusConflict
		}
		return map[string]any{"name": body.Name}, http.StatusCreated
	})
}

func (s *Server) removeProject(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("project")
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		if !document.RemoveProject(name) {
			return map[string]any{"error": map[string]any{"message": "project not found"}}, http.StatusNotFound
		}
		return nil, http.StatusNoContent
	})
}

func (s *Server) addArea(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Parent []string `json:"parent"`
		Name   string   `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	projectName := r.PathValue("project")
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		project := document.FindProject(projectName)
		if project == nil {
			return errorBody("project not found"), http.StatusNotFound
		}
		switch err := project.AddArea(body.Parent, body.Name); {
		case errors.Is(err, projects.ErrInvalidName):
			return errorBody("invalid name"), http.StatusBadRequest
		case errors.Is(err, projects.ErrAreaNotFound):
			return errorBody("parent area not found"), http.StatusNotFound
		case errors.Is(err, projects.ErrDuplicateName):
			return errorBody("name already exists"), http.StatusConflict
		}
		return map[string]any{"name": body.Name}, http.StatusCreated
	})
}

// removeArea はDELETE /areas/{path...}。子Areaごと消す。
func (s *Server) removeArea(w http.ResponseWriter, r *http.Request) {
	areaPath := splitAreaPath(r.PathValue("rest"))
	projectName := r.PathValue("project")
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		project := document.FindProject(projectName)
		if project == nil {
			return errorBody("project not found"), http.StatusNotFound
		}
		if !project.RemoveArea(areaPath) {
			return errorBody("area not found"), http.StatusNotFound
		}
		return nil, http.StatusNoContent
	})
}

func (s *Server) getPinned(w http.ResponseWriter, r *http.Request) {
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		project := document.FindProject(r.PathValue("project"))
		if project == nil {
			return errorBody("project not found"), http.StatusNotFound
		}
		return project.Pinned, http.StatusOK
	})
}

func (s *Server) putPinned(w http.ResponseWriter, r *http.Request) {
	body, ok := readOpaque(w, r)
	if !ok {
		return
	}
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		project := document.FindProject(r.PathValue("project"))
		if project == nil {
			return errorBody("project not found"), http.StatusNotFound
		}
		project.Pinned = body
		return nil, http.StatusNoContent
	})
}

func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	s.withWorkspace(w, r, func(_ *projects.Project, area *projects.Area) (any, int) {
		if area == nil {
			return errorBody("area not found"), http.StatusNotFound
		}
		return area.Workspace, http.StatusOK
	})
}

func (s *Server) putWorkspace(w http.ResponseWriter, r *http.Request) {
	body, ok := readOpaque(w, r)
	if !ok {
		return
	}
	s.withWorkspace(w, r, func(_ *projects.Project, area *projects.Area) (any, int) {
		if area == nil {
			return errorBody("area not found"), http.StatusNotFound
		}
		area.Workspace = body
		return nil, http.StatusNoContent
	})
}

// readOpaque はShell所有のJSONをそのまま読む。objectかnull以外は400。
func readOpaque(w http.ResponseWriter, r *http.Request) (json.RawMessage, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil || !projects.ValidOpaque(body) {
		writeError(w, http.StatusBadRequest, "body must be a JSON object or null")
		return nil, false
	}
	return json.RawMessage(body), true
}

// withWorkspace はパスの{rest...}末尾の"workspace"を切り分け、
// Project/Areaを引いてhandleへ渡す（変更系ならprojectContextが保存する）。
func (s *Server) withWorkspace(w http.ResponseWriter, r *http.Request, handle func(project *projects.Project, area *projects.Area) (any, int)) {
	areaPath, isWorkspace := splitWorkspacePath(r.PathValue("rest"))
	if !isWorkspace {
		writeError(w, http.StatusNotFound, "unknown endpoint")
		return
	}
	s.projectContext(w, r, func(document *projects.Document) (any, int) {
		project := document.FindProject(r.PathValue("project"))
		if project == nil {
			return errorBody("project not found"), http.StatusNotFound
		}
		return handle(project, project.FindArea(areaPath))
	})
}

// splitAreaPath は"main/feature-a"を["main","feature-a"]へ。
func splitAreaPath(rest string) []string {
	parts := strings.Split(rest, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// splitWorkspacePath は{rest...}の末尾が"workspace"ならその手前をAreaパスとして返す。
func splitWorkspacePath(rest string) (areaPath []string, workspace bool) {
	parts := splitAreaPath(rest)
	if len(parts) > 0 && parts[len(parts)-1] == "workspace" {
		return parts[:len(parts)-1], true
	}
	return parts, false
}

func errorBody(message string) map[string]any {
	return map[string]any{"error": map[string]any{"message": message}}
}
