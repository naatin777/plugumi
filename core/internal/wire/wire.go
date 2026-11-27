// Package wire はPlugin起点のRESTとJSON-RPCのGoバインディング（contracts/00004）。
package wire

import (
	"encoding/json"
	"fmt"
	"time"
)

// ProviderIdentity は登録時の実装名とinstance、および所属。
// providerKind enumは廃止。所属はenvironment / hostSessionのどちらか一方だけ
// 指定でき、両方なければglobal / serviceとして扱う（contracts/00004）。
type ProviderIdentity struct {
	ProviderID  string `json:"providerId" minLength:"1"`
	InstanceID  string `json:"instanceId" minLength:"1"`
	Environment string `json:"environment,omitempty"`
	HostSession string `json:"hostSession,omitempty"`
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
	RegistrationID string                `json:"registrationId"`
	ProviderID     string                `json:"providerId"`
	Environment    string                `json:"environment,omitempty"`
	HostSession    string                `json:"hostSession,omitempty"`
	RPCAvailable   bool                  `json:"rpcAvailable"`
	Operations     []OperationDeclaration `json:"operations"`
	Panels         []PanelDeclaration    `json:"panels,omitempty"`
	UISHA256       string                `json:"uiSha256,omitempty"`
}

// OperationDeclaration はcontracts/00004のoperation宣言。
// kind（sync / async）、targetAxes、lifetimeは宣言しない。
type OperationDeclaration struct {
	Path               string          `json:"path" minLength:"1"`
	Description        string          `json:"description,omitempty"`
	InputSchema        json.RawMessage `json:"inputSchema,omitempty"`
	AcceptSchema       json.RawMessage `json:"acceptSchema,omitempty"`
	StreamSchema       json.RawMessage `json:"streamSchema,omitempty"`
	ResultSchema       json.RawMessage `json:"resultSchema,omitempty"`
	PresentationSchema json.RawMessage `json:"presentationSchema,omitempty"`
	Embed              *EmbedDeclaration `json:"embed,omitempty"`
}

// EmbedDeclaration はtool紐付け自動表示の宣言。形式は検討中（contracts/00004）。
type EmbedDeclaration struct {
	Component string `json:"component,omitempty"`
	Catalog   string `json:"catalog,omitempty"`
}

// PanelDeclaration はPluginが宣言するUIパネル。entryはUI file一覧内の
// パスで、GET /v1/ui/{registrationId}/{entry} から取得する。
// styles も同じくfiles内のパスで、Clientがentryより先に読み込む。
type PanelDeclaration struct {
	PanelID string   `json:"panelId"`
	Title   string   `json:"title"`
	Entry   string   `json:"entry"`
	Styles  []string `json:"styles,omitempty"`
}

// UIFile はUI manifestが参照する1ファイル。pathは相対パス、
// sha256はPUT /v1/assets/{sha256}で事前に送った内容アドレス。
type UIFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

// UIManifest はPUT /v1/registrations/{registrationId}/uiの本文。
// filesとpanelsが両方空ならUIを解除する。
type UIManifest struct {
	Files  []UIFile           `json:"files"`
	Panels []PanelDeclaration `json:"panels"`
}

// CoreInfo はGET /v1/coreの応答。coreIdは起動ごとに変わる。
type CoreInfo struct {
	CoreID string `json:"coreId"`
	Name   string `json:"name,omitempty"`
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
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError はJSON-RPC 2.0のerror object。
type RPCError struct {
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
	Error   *RPCError       `json:"error,omitempty"`
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

// operation invocation / Executionのメソッド（contracts/00004）。
const (
	MethodOperationsInvoke = "operations.invoke"
	MethodOperationsList   = "operations.list"
	MethodOperationsEvent  = "operations.event"  // provider → Core
	MethodExecutionsEvent  = "executions.event"  // Core → 購読者
	MethodExecutionsGet    = "executions.get"
	MethodExecutionsList   = "executions.list"
	MethodExecutionsCancel = "executions.cancel"
)

// Execution status。unknownは持たない（contracts/00004）。
const (
	ExecutionQueued    = "queued"
	ExecutionRunning   = "running"
	ExecutionSucceeded = "succeeded"
	ExecutionFailed    = "failed"
	ExecutionCancelled = "cancelled"
)

// error kind。実行そのものの失敗と接続喪失を区別する。
const (
	ErrorKindExecutionFailed     = "executionFailed"
	ErrorKindProviderDisconnected = "providerDisconnected"
)

type ExecutionError struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
	Kind    string          `json:"kind,omitempty"`
}

// Execution はCoreが記録するoperation invocationの実行。
type Execution struct {
	ID            string          `json:"id"`
	Operation     string          `json:"operation"`
	Status        string          `json:"status"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	Context       json.RawMessage `json:"context,omitempty"`
	Input         json.RawMessage `json:"input,omitempty"`
	Accept        json.RawMessage `json:"accept,omitempty"`
	Progress      json.RawMessage `json:"progress,omitempty"`
	Result        json.RawMessage `json:"result,omitempty"`
	Error         *ExecutionError `json:"error,omitempty"`
	Presentation  json.RawMessage `json:"presentation,omitempty"`
	ResourceRefs  json.RawMessage `json:"resourceRefs,omitempty"`
	ParentExecution string        `json:"parentExecution,omitempty"`
}

// InvokeParams はcaller→Coreのoperations.invoke params。
type InvokeParams struct {
	Operation string          `json:"operation"`
	Input     json.RawMessage `json:"input"`
	Context   json.RawMessage `json:"context,omitempty"`
}

// ForwardInvokeParams はCore→providerのoperations.invoke params。
type ForwardInvokeParams struct {
	Operation   string          `json:"operation"`
	ExecutionID string          `json:"executionId"`
	Input       json.RawMessage `json:"input"`
}

// ProviderInvokeResult はproviderのoperations.invoke応答。
// runningまたはterminal状態を返す。
type ProviderInvokeResult struct {
	Status   string          `json:"status"`
	Progress json.RawMessage `json:"progress,omitempty"`
	Result   json.RawMessage `json:"result,omitempty"`
	Error    *ExecutionError `json:"error,omitempty"`
	Accept   json.RawMessage `json:"accept,omitempty"`
}

// OperationsEventParams はprovider→Coreのoperations.event params。
type OperationsEventParams struct {
	ExecutionID string          `json:"executionId"`
	Seq         uint64          `json:"seq"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload,omitempty"`
}

// InvokeResult はCore→callerのoperations.invoke応答。
type InvokeResult struct {
	Execution *Execution `json:"execution"`
}
