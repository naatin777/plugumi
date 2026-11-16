// Package wire はCore↔Plugin契約（docs/contracts/00001-00003）のGoバインディング。
package wire

import (
	"encoding/json"
	"fmt"
)

// ---- Link確立（transport上のJSON-RPC） ----

// HelloRequest は link.hello（Core→Plugin request）のparams。
// PluginはCoreのURLを知らないため、渡すのは識別子のみ。
type HelloRequest struct {
	LinkID string `json:"linkId"`
	Core   struct {
		ID      string `json:"id"`
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

type ToolDeclaration struct {
	ToolPath     string          `json:"toolPath"`
	Kind         string          `json:"kind"` // "sync" | "async"（省略時 sync）
	Description  string          `json:"description,omitempty"`
	Tags         []string        `json:"tags,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema,omitempty"`
	OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
}

// ToolsSetRequest は tools.set（Plugin→Core request）のparams。
// transportがLinkに紐付くため linkId は持たない。
type ToolsSetRequest struct {
	Tools []ToolDeclaration `json:"tools"`
}

type ToolsSetResult struct {
	Count int `json:"count"`
}

// ListedTool は tools.catalog・管理REST tools.list の1要素。
// linkId がTool呼び出しの宛先になる。
type ListedTool struct {
	LinkID string `json:"linkId"`
	ToolDeclaration
}

// ToolsCatalogParams は tools.catalog（Core→Plugin notification）のparams。
// 登録中の全Toolを全置換でpushする。
type ToolsCatalogParams struct {
	Tools []ListedTool `json:"tools"`
}

// PluginsAddRequest は plugins.add（transport）と管理REST POST /v1/plugins のparams。
// 登録は受理のみ。Linkの確立は非同期（connectorが再試行する）。
type PluginsAddRequest struct {
	Endpoint string `json:"endpoint"`
}

type PluginsAddResult struct {
	Endpoint string `json:"endpoint"`
}

// RegisteredPlugin は登録済みEndpoint1行分。Link未確立なら
// linkId/pluginIdは空（接続再試行中）。
type RegisteredPlugin struct {
	Endpoint string `json:"endpoint"`
	LinkID   string `json:"linkId,omitempty"`
	PluginID string `json:"pluginId,omitempty"`
}

type PluginsListResult struct {
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
	MethodLinkHello    = "link.hello"
	MethodLinkPing     = "link.ping"
	MethodToolsSet     = "tools.set"
	MethodToolsCatalog = "tools.catalog"
	MethodPluginsAdd   = "plugins.add"
	MethodPluginsList  = "plugins.list"
	MethodCall         = "tools.call"
	MethodCallOutput   = "tools.call.output"
	MethodCallResult   = "tools.call.result"
	MethodCallClose    = "tools.call.close"
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
