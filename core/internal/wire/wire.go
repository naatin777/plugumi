// Package wire はCore↔Plugin契約（docs/contracts/00001-00003）のGoバインディング。
package wire

import (
	"encoding/json"
	"fmt"
)

// ---- REST ----

type HelloRequest struct {
	ProtocolVersion string `json:"protocolVersion"`
	LinkID          string `json:"linkId"`
	Core            struct {
		URL     string `json:"url"`
		Version string `json:"version,omitempty"`
	} `json:"core"`
}

type HelloResponse struct {
	Plugin PluginInfo `json:"plugin"`
}

type PluginInfo struct {
	ID      string `json:"id"`
	Version string `json:"version,omitempty"`
	Name    string `json:"name,omitempty"`
}

type ToolDecl struct {
	ToolPath     string          `json:"toolPath"`
	Kind         string          `json:"kind"` // "sync" | "async"（省略時 sync）
	Description  string          `json:"description,omitempty"`
	Tags         []string        `json:"tags,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema,omitempty"`
	OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
}

type ToolsSetRequest struct {
	LinkID string     `json:"linkId"`
	Tools  []ToolDecl `json:"tools"`
}

type PingRequest struct {
	LinkID string `json:"linkId"`
}

type ToolsListRequest struct {
	LinkID string `json:"linkId"`
}

type ListedTool struct {
	LinkID string `json:"linkId"`
	ToolDecl
}

type ToolsListResponse struct {
	Tools []ListedTool `json:"tools"`
}

// PluginsAddRequest はPlugin Endpointの動的登録（POST /v1/plugins）。
// 登録は受理のみ — Linkの確立は非同期（connectorが再試行する）。
type PluginsAddRequest struct {
	Endpoint string `json:"endpoint"`
}

// RegisteredPlugin は登録済みEndpoint1行分。Link未確立なら
// linkId/pluginIdは空（接続再試行中）。
type RegisteredPlugin struct {
	Endpoint string `json:"endpoint"`
	LinkID   string `json:"linkId,omitempty"`
	PluginID string `json:"pluginId,omitempty"`
}

type PluginsListResponse struct {
	Plugins []RegisteredPlugin `json:"plugins"`
}

// ---- JSON-RPC 2.0 ----

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Notification struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type Error struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Incoming は受信メッセージの判別用の生構造。
type Incoming struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

func (in *Incoming) IsRequest() bool  { return in.Method != "" && len(in.ID) > 0 }
func (in *Incoming) IsNotif() bool    { return in.Method != "" && len(in.ID) == 0 }
func (in *Incoming) IsResponse() bool { return in.Method == "" }

func Marshal(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(fmt.Sprintf("wire.Marshal: %v", err))
	}
	return b
}

func Unmarshal(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, v)
}

const (
	MethodCall       = "tools.call"
	MethodCallOutput = "tools.call.output"
	MethodCallResult = "tools.call.result"
	MethodCallClose  = "tools.call.close"
)

type CallTarget struct {
	LinkID   string `json:"linkId"`
	ToolPath string `json:"toolPath"`
}

type CallParams struct {
	Target CallTarget      `json:"target"`
	Input  json.RawMessage `json:"input,omitempty"`
}

// ForwardCallParams は中継時にtargetへ渡すparams。
// docs/contracts/00003: targetへはtoolPathのみ伝える。
type ForwardCallParams struct {
	ToolPath string          `json:"toolPath"`
	Input    json.RawMessage `json:"input,omitempty"`
}

type CallOutputParams struct {
	CallID  json.RawMessage `json:"callId"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type CallResultParams struct {
	CallID json.RawMessage `json:"callId"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

type CallCloseParams struct {
	CallID json.RawMessage `json:"callId"`
}
