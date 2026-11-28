// /api/cores 系のoperation。Coreの登録・除去・参照。
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/naatin777/plugumi/apps/web/internal/corerest"
	"github.com/naatin777/plugumi/apps/web/internal/cores"
)

type coreKeyInput struct {
	Key string `path:"key" minLength:"1"`
}

type coreOutput struct {
	Body cores.Core
}

func (s *Server) registerCoreOps() {
	huma.Register(s.api, huma.Operation{
		OperationID: "listCores", Method: http.MethodGet, Path: "/api/cores",
		Summary: "登録されているCoreの一覧",
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body []cores.Core }, error) {
		return &struct{ Body []cores.Core }{Body: s.manager.List()}, nil
	})

	huma.Register(s.api, huma.Operation{
		OperationID: "getCore", Method: http.MethodGet, Path: "/api/cores/{key}",
		Summary: "keyでCoreを引く",
	}, func(ctx context.Context, input *coreKeyInput) (*coreOutput, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		return &coreOutput{Body: core}, nil
	})

	type addCoreInput struct {
		Body struct {
			URL string `json:"url" minLength:"1" doc:"Coreの待受URL（http://host:port）"`
		}
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "addCore", Method: http.MethodPost, Path: "/api/cores",
		Summary: "Coreを登録する", DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, input *addCoreInput) (*coreOutput, error) {
		normalized, err := cores.NormalizeURL(input.Body.URL)
		if err != nil {
			return nil, newAPIError(http.StatusBadRequest, err.Error())
		}
		if _, exists := s.manager.Get(normalized); exists {
			return nil, newAPIError(http.StatusConflict, fmt.Sprintf("Core at %s is already registered", normalized))
		}
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		info, err := corerest.FetchCoreInfo(probeCtx, s.probeClient(), s.token, normalized)
		cancel()
		if err != nil {
			var httpErr *corerest.StatusError
			if errors.As(err, &httpErr) {
				return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("Core at %s returned %s", normalized, err))
			}
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("Core at %s is unreachable: %v", normalized, err))
		}
		if info.Name == "" {
			return nil, newAPIError(http.StatusBadRequest, "core.name を設定してください")
		}
		if cores.ReservedName(info.Name) {
			return nil, newAPIError(http.StatusBadRequest, fmt.Sprintf("Core name %q is reserved by the web plugin; choose another core.name", info.Name))
		}
		if conflict, taken := s.manager.NameTaken(info.Name, normalized); taken {
			return nil, newAPIError(http.StatusConflict, fmt.Sprintf("Core name %q is already used by %s", info.Name, conflict.URL))
		}
		if err := s.manager.Add(normalized, cores.SourceSaved); err != nil {
			return nil, newAPIError(http.StatusConflict, err.Error())
		}
		s.manager.SetInfo(normalized, info)
		if s.store != nil {
			if err := s.store.Add(normalized); err != nil {
				s.manager.Remove(normalized)
				return nil, newAPIError(http.StatusInternalServerError, fmt.Sprintf("could not save Core list: %v", err))
			}
		}
		core, _ := s.manager.Get(normalized)
		return &coreOutput{Body: core}, nil
	})

	type removeCoreInput struct {
		URL string `query:"url" minLength:"1"`
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "removeCore", Method: http.MethodDelete, Path: "/api/cores",
		Summary: "Coreを登録から外す", DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, input *removeCoreInput) (*struct{}, error) {
		normalized, err := cores.NormalizeURL(input.URL)
		if err != nil {
			return nil, newAPIError(http.StatusBadRequest, err.Error())
		}
		core, found := s.manager.Get(normalized)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		if core.Source != cores.SourceSaved {
			return nil, newAPIError(http.StatusBadRequest, "Cores passed on the command line cannot be removed")
		}
		s.manager.Remove(normalized)
		if s.store != nil {
			if err := s.store.Remove(normalized); err != nil {
				return nil, newAPIError(http.StatusInternalServerError, fmt.Sprintf("could not save Core list: %v", err))
			}
		}
		return nil, nil
	})
}
