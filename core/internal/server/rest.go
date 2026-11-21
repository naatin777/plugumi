// HumaでPlugin起点のRESTとクライアント生成用のOpenAPIを定義する。
package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/wire"
)

type apiError struct {
	status int
	Body   struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (e *apiError) Error() string  { return e.Body.Message }
func (e *apiError) GetStatus() int { return e.status }

func newAPIError(status int, code, message string) *apiError {
	result := &apiError{status: status}
	result.Body.Code = code
	result.Body.Message = message
	return result
}

func init() {
	huma.NewError = func(status int, message string, _ ...error) huma.StatusError {
		switch status {
		case http.StatusBadRequest, http.StatusUnprocessableEntity:
			return newAPIError(http.StatusBadRequest, "invalid_params", message)
		case http.StatusRequestEntityTooLarge:
			return newAPIError(status, "payload_too_large", message)
		default:
			return newAPIError(status, "http_error", message)
		}
	}
}

type registrationPath struct {
	RegistrationID string `path:"registrationId" minLength:"1"`
}

type toolDeclarations struct {
	Tools []wire.ToolDeclaration `json:"tools"`
}

type leaseResponse struct {
	Status int
	Body   wire.RegistrationLease
}

func (s *Server) registerREST(mux *http.ServeMux) {
	config := huma.DefaultConfig("Plugumi Core", "1.0.0")
	config.CreateHooks = nil
	config.Servers = []*huma.Server{{URL: "/"}}
	config.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"coreBearer": {Type: "http", Scheme: "bearer", Description: "Required when the local Core sets PLUGUMI_TOKEN."},
	}
	config.Security = []map[string][]string{{"coreBearer": {}}, {}}
	api := humago.New(mux, config)
	registrationsPath := prefix + "/registrations"
	huma.Register(api, huma.Operation{
		OperationID: "createRegistration", Method: http.MethodPost, Path: registrationsPath,
		Summary: "Pluginを登録する", DefaultStatus: http.StatusCreated,
	}, s.createRegistration)
	responses := api.OpenAPI().Paths[registrationsPath].Post.Responses
	retried := *responses["201"]
	retried.Description = "Existing registration with a refreshed lease"
	responses["200"] = &retried
	huma.Post(api, registrationsPath+"/{registrationId}/renew", s.renewRegistration,
		func(operation *huma.Operation) {
			operation.OperationID = "renewRegistration"
			operation.Summary = "登録のLeaseを更新する"
		})
	huma.Put(api, registrationsPath+"/{registrationId}/tools", s.replaceTools,
		func(operation *huma.Operation) {
			operation.OperationID = "replaceToolDeclarations"
			operation.Summary = "Tool宣言を置き換える"
		})
	huma.Delete(api, registrationsPath+"/{registrationId}", s.deleteRegistration,
		func(operation *huma.Operation) {
			operation.OperationID = "deleteRegistration"
			operation.Summary = "登録を削除する"
		})
	huma.Get(api, prefix+"/registry", func(context.Context, *struct{}) (*struct{ Body wire.RegistrySnapshot }, error) {
		return &struct{ Body wire.RegistrySnapshot }{Body: s.registry.Snapshot()}, nil
	}, func(operation *huma.Operation) {
		operation.OperationID = "getRegistrySnapshot"
		operation.Summary = "RegistryのSnapshotを取得する"
	})
}

func (s *Server) createRegistration(_ context.Context, input *struct{ Body wire.PluginIdentity }) (*leaseResponse, error) {
	identity := input.Body
	if strings.TrimSpace(identity.PluginID) == "" || strings.TrimSpace(identity.PluginInstanceID) == "" {
		return nil, newAPIError(http.StatusBadRequest, "invalid_params", "pluginId and pluginInstanceId are required")
	}
	lease, created, err := s.registry.Create(identity)
	if err != nil {
		return nil, newAPIError(http.StatusConflict, "registration_conflict", err.Error())
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	return &leaseResponse{Status: status, Body: lease}, nil
}

func (s *Server) renewRegistration(_ context.Context, input *registrationPath) (*struct{ Body wire.RegistrationLease }, error) {
	lease, found := s.registry.Renew(input.RegistrationID)
	if !found {
		return nil, newAPIError(http.StatusNotFound, "unknown_registration", "unknown registration")
	}
	return &struct{ Body wire.RegistrationLease }{Body: lease}, nil
}

func (s *Server) replaceTools(_ context.Context, input *struct {
	RegistrationID string `path:"registrationId" minLength:"1"`
	Body           toolDeclarations
}) (*struct{}, error) {
	tools := input.Body.Tools
	if tools == nil {
		return nil, newAPIError(http.StatusBadRequest, "invalid_params", "tools must be an array")
	}
	switch err := s.registry.ReplaceTools(input.RegistrationID, tools); err {
	case nil:
		return nil, nil
	case registry.ErrInvalidTools:
		return nil, newAPIError(http.StatusBadRequest, "invalid_params", err.Error())
	case registry.ErrUnknownRegistration:
		return nil, newAPIError(http.StatusNotFound, "unknown_registration", "unknown registration")
	default:
		return nil, newAPIError(http.StatusInternalServerError, "http_error", "could not replace Tool declarations")
	}
}

func (s *Server) deleteRegistration(_ context.Context, input *registrationPath) (*struct{}, error) {
	if !s.registry.Delete(input.RegistrationID) {
		return nil, newAPIError(http.StatusNotFound, "unknown_registration", "unknown registration")
	}
	return nil, nil
}
