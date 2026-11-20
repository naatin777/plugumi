// Package wire はPlugin起点のRESTとJSON-RPCのGoバインディング（contracts/00004）。
package wire

import (
	"encoding/json"
	"fmt"
	"time"
)

type PluginIdentity struct {
	PluginID         string `json:"pluginId" minLength:"1"`
	PluginInstanceID string `json:"pluginInstanceId" minLength:"1"`
}

type RegistrationLease struct {
	CoreID         string    `json:"coreId"`
	RegistrationID string    `json:"registrationId"`
	LeaseSeconds   int       `json:"leaseSeconds"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

type RegistrySnapshot struct {
	CoreID        string                 `json:"coreId"`
	Revision      string                 `json:"revision"`
	Registrations []RegistryRegistration `json:"registrations"`
}

type RegistryRegistration struct {
	RegistrationID string            `json:"registrationId"`
	PluginID       string            `json:"pluginId"`
	RPCAvailable   bool              `json:"rpcAvailable"`
	Tools          []ToolDeclaration `json:"tools"`
}

type ToolDeclaration struct {
	ToolPath     string          `json:"toolPath" minLength:"1"`
	Kind         string          `json:"kind,omitempty" enum:"sync,async" default:"sync"`
	Description  string          `json:"description,omitempty"`
	Tags         []string        `json:"tags,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema,omitempty"`
	OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
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
	Error   *RpcError       `json:"error,omitempty"`
}

// RpcError はJSON-RPC 2.0のerror object。
type RpcError struct {
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
	Error   *RpcError       `json:"error,omitempty"`
}

func (in *Incoming) IsRequest() bool      { return in.Method != "" && len(in.ID) > 0 }
func (in *Incoming) IsNotification() bool { return in.Method != "" && len(in.ID) == 0 }
func (in *Incoming) IsResponse() bool     { return in.Method == "" }

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

// Tool呼び出しのメソッド（contracts/00004のローカル実装範囲）。
const (
	MethodCall       = "tools.call"
	MethodCallChunk  = "tools.call.chunk"
	MethodCallResult = "tools.call.result"
	MethodCallClose  = "tools.call.close"
)

type CallTarget struct {
	RegistrationID string `json:"registrationId"`
	ToolPath       string `json:"toolPath"`
}

type CallParams struct {
	Target CallTarget      `json:"target"`
	Input  json.RawMessage `json:"input,omitempty"`
}

// ForwardCallParams は中継時にtargetへ渡すparams。
// contracts/00004: targetへはtoolPathのみ伝える。
type ForwardCallParams struct {
	ToolPath string          `json:"toolPath"`
	Input    json.RawMessage `json:"input,omitempty"`
}

type CallChunkParams struct {
	CallID  json.RawMessage `json:"callId"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type CallResultParams struct {
	CallID json.RawMessage `json:"callId"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RpcError       `json:"error,omitempty"`
}

type CallCloseParams struct {
	CallID json.RawMessage `json:"callId"`
}
