// /api/cores/{key}/projects 系のoperation。
// Areaパスは階層（a/b/c）なのでpathには載せられない — OpenAPIは
// マルチセグメントのwildcardを表現できないため、queryのpath参数で渡す
// （旧areas/{rest...}・areas/{rest...}/workspaceからの再設計）。
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/naatin777/plugumi/apps/web/internal/projects"
)

// withDocument はProject APIの共通下ごしらえ（旧projectContext）。
// key→Core（name必須）とDocumentを引き、writeなら保存まで行う。
// 返り値は（body, status）— 400以上ならbodyはerrorBody形。
func (s *Server) withDocument(key string, write bool, mutate func(document *projects.Document) (any, int)) (any, int) {
	core, found := s.manager.FindByKey(key)
	if !found {
		return errorBody("no such Core"), http.StatusNotFound
	}
	if core.Name == "" {
		return errorBody("core.name を設定してください"), http.StatusConflict
	}
	s.documents.Lock()
	defer s.documents.Unlock()
	document, err := projects.Load(s.webDir, core.Name)
	if err != nil {
		return errorBody(fmt.Sprintf("could not read projects: %v", err)), http.StatusInternalServerError
	}
	body, status := mutate(document)
	if status >= 400 || !write {
		return body, status
	}
	if err := projects.Save(s.webDir, core.Name, document); err != nil {
		return errorBody(fmt.Sprintf("could not save projects: %v", err)), http.StatusInternalServerError
	}
	return body, status
}

// errFromBody はwithDocumentの失敗をhumaのerrorへ変換する。
func errFromBody(body any, status int) error {
	if m, ok := body.(map[string]any); ok {
		if e, ok := m["error"].(map[string]any); ok {
			if msg, ok := e["message"].(string); ok {
				return newAPIError(status, msg)
			}
		}
	}
	return newAPIError(status, "unknown error")
}

func splitAreaPathParam(path string) []string {
	parts := strings.Split(path, "/")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (s *Server) registerProjectOps() {
	huma.Register(s.api, huma.Operation{
		OperationID: "listProjects", Method: http.MethodGet, Path: "/api/cores/{key}/projects",
		Summary: "Project treeの一覧",
	}, func(ctx context.Context, input *coreKeyInput) (*struct{ Body []projects.ProjectTree }, error) {
		var trees []projects.ProjectTree
		body, status := s.withDocument(input.Key, false, func(document *projects.Document) (any, int) {
			trees = document.Trees()
			return nil, http.StatusOK
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return &struct{ Body []projects.ProjectTree }{Body: trees}, nil
	})

	type addProjectInput struct {
		Key  string `path:"key" minLength:"1"`
		Body struct {
			Title string `json:"title"`
		}
	}
	type keyTitleOutput struct {
		Status int
		Body   struct {
			Key   string `json:"key"`
			Title string `json:"title"`
		}
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "addProject", Method: http.MethodPost, Path: "/api/cores/{key}/projects",
		Summary: "Projectを作る", DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, input *addProjectInput) (*keyTitleOutput, error) {
		out := &keyTitleOutput{Status: http.StatusCreated}
		body, status := s.withDocument(input.Key, true, func(document *projects.Document) (any, int) {
			key, err := document.AddProject(input.Body.Title)
			if errors.Is(err, projects.ErrInvalidTitle) {
				return errorBody("invalid title"), http.StatusBadRequest
			}
			if err != nil {
				return errorBody(fmt.Sprintf("could not create project: %v", err)), http.StatusInternalServerError
			}
			out.Body.Key = key
			out.Body.Title = input.Body.Title
			return nil, http.StatusCreated
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return out, nil
	})

	type addAreaInput struct {
		Key     string `path:"key" minLength:"1"`
		Project string `path:"project" minLength:"1"`
		Body    struct {
			Parent []string `json:"parent"`
			Title  string   `json:"title"`
		}
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "addArea", Method: http.MethodPost, Path: "/api/cores/{key}/projects/{project}/areas",
		Summary: "Areaを作る", DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, input *addAreaInput) (*keyTitleOutput, error) {
		out := &keyTitleOutput{Status: http.StatusCreated}
		body, status := s.withDocument(input.Key, true, func(document *projects.Document) (any, int) {
			project := document.FindProject(input.Project)
			if project == nil {
				return errorBody("project not found"), http.StatusNotFound
			}
			key, err := project.AddArea(input.Body.Parent, input.Body.Title)
			switch {
			case errors.Is(err, projects.ErrInvalidTitle):
				return errorBody("invalid title"), http.StatusBadRequest
			case errors.Is(err, projects.ErrAreaNotFound):
				return errorBody("parent area not found"), http.StatusNotFound
			case err != nil:
				return errorBody(fmt.Sprintf("could not create area: %v", err)), http.StatusInternalServerError
			}
			out.Body.Key = key
			out.Body.Title = input.Body.Title
			return nil, http.StatusCreated
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return out, nil
	})

	type areaPathInput struct {
		Key     string `path:"key" minLength:"1"`
		Project string `path:"project" minLength:"1"`
		Path    string `query:"path" doc:"Areaの階層パス（a/b/c）"`
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "removeArea", Method: http.MethodDelete, Path: "/api/cores/{key}/projects/{project}/areas",
		Summary: "Areaを子ごと消す", DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, input *areaPathInput) (*struct{}, error) {
		areaPath := splitAreaPathParam(input.Path)
		body, status := s.withDocument(input.Key, true, func(document *projects.Document) (any, int) {
			project := document.FindProject(input.Project)
			if project == nil {
				return errorBody("project not found"), http.StatusNotFound
			}
			if !project.RemoveArea(areaPath) {
				return errorBody("area not found"), http.StatusNotFound
			}
			return nil, http.StatusNoContent
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return nil, nil
	})

	huma.Register(s.api, huma.Operation{
		OperationID: "getWorkspace", Method: http.MethodGet, Path: "/api/cores/{key}/projects/{project}/workspace",
		Summary: "Areaのworkspace（Shell所有のopaque JSON）を返す",
	}, func(ctx context.Context, input *areaPathInput) (*struct{ Body projects.Opaque }, error) {
		var workspace projects.Opaque
		areaPath := splitAreaPathParam(input.Path)
		body, status := s.withDocument(input.Key, false, func(document *projects.Document) (any, int) {
			project := document.FindProject(input.Project)
			if project == nil {
				return errorBody("project not found"), http.StatusNotFound
			}
			area := project.FindArea(areaPath)
			if area == nil {
				return errorBody("area not found"), http.StatusNotFound
			}
			workspace = area.Workspace
			return nil, http.StatusOK
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return &struct{ Body projects.Opaque }{Body: workspace}, nil
	})

	type putWorkspaceInput struct {
		Key     string `path:"key" minLength:"1"`
		Project string `path:"project" minLength:"1"`
		Path    string `query:"path" doc:"Areaの階層パス（a/b/c）"`
		RawBody []byte `contentType:"application/json"`
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "putWorkspace", Method: http.MethodPut, Path: "/api/cores/{key}/projects/{project}/workspace",
		Summary: "Areaのworkspaceを保存する", DefaultStatus: http.StatusNoContent,
		// workspaceはopaqueなJSON object — []byteのschema（string/byte）に
		// 対するvalidationは意味がないので切り、ValidOpaqueで手動検証する。
		SkipValidateBody: true,
	}, func(ctx context.Context, input *putWorkspaceInput) (*struct{}, error) {
		if !projects.ValidOpaque(input.RawBody) {
			return nil, newAPIError(http.StatusBadRequest, "body must be a JSON object or null")
		}
		areaPath := splitAreaPathParam(input.Path)
		body, status := s.withDocument(input.Key, true, func(document *projects.Document) (any, int) {
			project := document.FindProject(input.Project)
			if project == nil {
				return errorBody("project not found"), http.StatusNotFound
			}
			area := project.FindArea(areaPath)
			if area == nil {
				return errorBody("area not found"), http.StatusNotFound
			}
			area.Workspace = input.RawBody
			return nil, http.StatusNoContent
		})
		if status >= 400 {
			return nil, errFromBody(body, status)
		}
		return nil, nil
	})

	// workspaceのopaque JSONはhumaのschema生成では[]byte=string/byteに
	// なってしまう。実態はJSON object|nullなのでspecを正しい形に直す。
	// （coreのrest.goがresponseをpost-processするのと同じやり方）
	workspaceSchema := &huma.Schema{Type: "object", Nullable: true}
	wsPath := s.api.OpenAPI().Paths["/api/cores/{key}/projects/{project}/workspace"]
	if wsPath.Put != nil && wsPath.Put.RequestBody != nil && wsPath.Put.RequestBody.Content != nil {
		for _, media := range wsPath.Put.RequestBody.Content {
			media.Schema = workspaceSchema
		}
	}
	if wsPath.Get != nil {
		if ok := wsPath.Get.Responses["200"]; ok != nil {
			for _, media := range ok.Content {
				media.Schema = workspaceSchema
			}
		}
	}
}
