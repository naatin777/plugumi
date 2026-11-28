// Humaによる/apiの定義。handlerのロジックはserver.goのままのものを
// input/output型でくるんだ形へ移し、OpenAPI specを生成できるようにする。
// エラー形はこれまでの{"error":{"message":...}}を保つ（frontendが読む）。
package server

import (
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
)

type apiError struct {
	status int
	Body   struct {
		Code    any    `json:"code,omitempty"`
		Message string `json:"message"`
	} `json:"error"`
}

func (e *apiError) Error() string  { return e.Body.Message }
func (e *apiError) GetStatus() int { return e.status }

func newAPIError(status int, message string) *apiError {
	result := &apiError{status: status}
	result.Body.Message = message
	return result
}

func init() {
	huma.NewError = func(status int, message string, _ ...error) huma.StatusError {
		return newAPIError(status, message)
	}
	// 配列はnullでなく常に配列で返す契約。specをnon-nullableにする代わりに、
	// Go側のresponse構築ではsliceを必ず初期化する（nilはnullになる）。
	huma.DefaultArrayNullable = false
}

// newHumaAPI は/api用のhuma APIをmuxへ登録する。specは-PrintOpenAPIで
// 書き出せるようServerへ保持する。
func (s *Server) newHumaAPI(mux *http.ServeMux) {
	config := huma.DefaultConfig("Plugumi Web", "1.0.0")
	config.CreateHooks = nil
	config.Servers = []*huma.Server{{URL: "/"}}
	s.api = humago.New(mux, config)
	s.registerCoreOps()
	s.registerPanelOps()
	s.registerProjectOps()
}

// OpenAPIJSON は生成されたspecをJSONで返す（--print-openapiで書き出す）。
func (s *Server) OpenAPIJSON() ([]byte, error) {
	if s.api == nil {
		// spec生成だけの用途ではstatic不要。Handlerを通さず直接登録する。
		s.newHumaAPI(http.NewServeMux())
	}
	return s.api.OpenAPI().Downgrade()
}
