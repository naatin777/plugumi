// /api/cores/{key}/panels・registrations・invoke・viewsのoperation。
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/naatin777/plugumi/apps/web/internal/corerest"
	"github.com/naatin777/plugumi/apps/web/internal/corerpc"
)

func (s *Server) registerPanelOps() {
	huma.Register(s.api, huma.Operation{
		OperationID: "listPanels", Method: http.MethodGet, Path: "/api/cores/{key}/panels",
		Summary: "CoreのRegistryが持つPanelを平らにして返す",
	}, func(ctx context.Context, input *coreKeyInput) (*struct{ Body []panelEntry }, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		snapshot, err := corerest.FetchRegistry(ctx, s.coreHTTP, s.token, core.URL)
		if err != nil {
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("could not read Core registry: %v", err))
		}
		panels := []panelEntry{}
		for _, registration := range snapshot.Registrations {
			for _, panel := range registration.Panels {
				panels = append(panels, panelEntry{
					RegistrationID: registration.RegistrationID, ProviderID: registration.ProviderID,
					PanelID: panel.PanelID, Title: panel.Title, Entry: panel.Entry,
					Styles: panel.Styles, UISHA256: registration.UISHA256,
					RPCAvailable: registration.RPCAvailable,
				})
			}
		}
		return &struct{ Body []panelEntry }{Body: panels}, nil
	})

	huma.Register(s.api, huma.Operation{
		OperationID: "listRegistrations", Method: http.MethodGet, Path: "/api/cores/{key}/registrations",
		Summary: "CoreのRegistryの登録をそのまま返す",
	}, func(ctx context.Context, input *coreKeyInput) (*struct{ Body []corerest.RegistryRegistration }, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		snapshot, err := corerest.FetchRegistry(ctx, s.coreHTTP, s.token, core.URL)
		if err != nil {
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("could not read Core registry: %v", err))
		}
		return &struct{ Body []corerest.RegistryRegistration }{Body: snapshot.Registrations}, nil
	})

	type invokeInput struct {
		Key  string `path:"key" minLength:"1"`
		Body struct {
			Operation string          `json:"operation" minLength:"1"`
			Input     json.RawMessage `json:"input"`
		}
	}
	type invokeOutput struct {
		Body struct {
			Execution corerpc.Execution `json:"execution"`
		}
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "invokeOperation", Method: http.MethodPost, Path: "/api/cores/{key}/invoke",
		Summary: "operationを呼ぶ（terminalのExecutionだけ。stream系は扱わない）",
	}, func(ctx context.Context, input *invokeInput) (*invokeOutput, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		execution, rpcError, err := s.calls.For(core.URL).Invoke(ctx, input.Body.Operation, input.Body.Input)
		if rpcError != nil {
			apiErr := newAPIError(http.StatusBadGateway, rpcError.Message)
			apiErr.Body.Code = rpcError.Code
			return nil, apiErr
		}
		if err != nil {
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("could not invoke operation: %v", err))
		}
		if execution.Status != "succeeded" && execution.Status != "failed" {
			return nil, newAPIError(http.StatusBadRequest,
				fmt.Sprintf("operation %s is still %s; streaming operations are not supported here", input.Body.Operation, execution.Status))
		}
		out := &invokeOutput{}
		out.Body.Execution = *execution
		return out, nil
	})

	type createViewInput struct {
		Key  string `path:"key" minLength:"1"`
		Body struct {
			RegistrationID string `json:"registrationId" minLength:"1"`
			PanelID        string `json:"panelId" minLength:"1"`
		}
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "createView", Method: http.MethodPost, Path: "/api/cores/{key}/views",
		Summary: "view instanceを登録しticketを返す", DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, input *createViewInput) (*struct{ Body corerest.ViewTicket }, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		ticket, err := corerest.CreateViewInstance(ctx, s.coreHTTP, s.token, core.URL, input.Body.RegistrationID, input.Body.PanelID)
		if err != nil {
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("could not create view instance: %v", err))
		}
		return &struct{ Body corerest.ViewTicket }{Body: ticket}, nil
	})

	type closeViewInput struct {
		Key    string `path:"key" minLength:"1"`
		ViewID string `path:"viewId" minLength:"1"`
	}
	huma.Register(s.api, huma.Operation{
		OperationID: "closeView", Method: http.MethodDelete, Path: "/api/cores/{key}/views/{viewId}",
		Summary: "view instanceを閉じる", DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, input *closeViewInput) (*struct{}, error) {
		core, found := s.manager.FindByKey(input.Key)
		if !found {
			return nil, newAPIError(http.StatusNotFound, "no such Core")
		}
		if err := corerest.CloseViewInstance(ctx, s.coreHTTP, s.token, core.URL, input.ViewID); err != nil {
			return nil, newAPIError(http.StatusBadGateway, fmt.Sprintf("could not close view instance: %v", err))
		}
		return nil, nil
	})
}
