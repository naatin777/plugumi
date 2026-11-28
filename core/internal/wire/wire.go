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
	RegistrationID string                 `json:"registrationId"`
	ProviderID     string                 `json:"providerId"`
	Environment    string                 `json:"environment,omitempty"`
	HostSession    string                 `json:"hostSession,omitempty"`
	RPCAvailable   bool                   `json:"rpcAvailable"`
	Ready          bool                   `json:"ready"`
	Operations     []OperationDeclaration `json:"operations"`
	Panels         []PanelDeclaration     `json:"panels,omitempty"`
	UISHA256       string                 `json:"uiSha256,omitempty"`
}

// OperationDeclaration はcontracts/00004のoperation宣言。
// kind（sync / async）、targetAxes、lifetimeは宣言しない。
type OperationDeclaration struct {
	Path               string            `json:"path" minLength:"1"`
	Description        string            `json:"description,omitempty"`
	InputSchema        json.RawMessage   `json:"inputSchema,omitempty"`
	AcceptSchema       json.RawMessage   `json:"acceptSchema,omitempty"`
	StreamSchema       json.RawMessage   `json:"streamSchema,omitempty"`
	ResultSchema       json.RawMessage   `json:"resultSchema,omitempty"`
	PresentationSchema json.RawMessage   `json:"presentationSchema,omitempty"`
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

// UIFile はUI manifestが参照する1ファイル。pathは相対パス、sha256は内容アドレス、
// sizeは宣言時のファイルサイズ。内容は登録時に送らず、Coreがassets.getでfetchする。
type UIFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size,omitempty"`
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

// asset fetchのメソッド。Core → Provider方向。
const MethodAssetsGet = "assets.get"

// AssetsGetParams はCore→Providerのassets.get params。
// Providerはpathでファイルを特定し、内容をbase64で返す。
type AssetsGetParams struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

// AssetsGetResult はProviderのassets.get応答。contentはbase64。
type AssetsGetResult struct {
	Content string `json:"content"`
}

// operation invocation / Executionのメソッド（contracts/00004）。
const (
	MethodOperationsInvoke = "operations.invoke"
	MethodOperationsList   = "operations.list"
	MethodOperationsEvent  = "operations.event" // provider → Core
	MethodExecutionsEvent  = "executions.event" // Core → 購読者
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
	ErrorKindExecutionFailed      = "executionFailed"
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
	ID              string          `json:"id"`
	Operation       string          `json:"operation"`
	Status          string          `json:"status"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	Context         json.RawMessage `json:"context,omitempty"`
	Input           json.RawMessage `json:"input,omitempty"`
	Accept          json.RawMessage `json:"accept,omitempty"`
	Progress        json.RawMessage `json:"progress,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           *ExecutionError `json:"error,omitempty"`
	Presentation    json.RawMessage `json:"presentation,omitempty"`
	ResourceRefs    json.RawMessage `json:"resourceRefs,omitempty"`
	ParentExecution string          `json:"parentExecution,omitempty"`
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

// ---- view channel（designs/00011） ----

// view channelのメソッド。channelは対称なのでmessageは1つだけ。
const (
	MethodViewsConnect = "views.connect"
	MethodViewsMessage = "views.message"
	MethodViewsEvent   = "views.event"
	MethodViewsClose   = "views.close"
)

// view instanceのstatus。pendingはhostが登録したがviewが未接続、
// openは接続済み、closedは終了。
const (
	ViewPending = "pending"
	ViewOpen    = "open"
	ViewClosed  = "closed"
)

// ViewInstance はhostが開いたviewの1instance。
// instanceごとに1つのWS接続がbindされる。
type ViewInstance struct {
	ID             string    `json:"id"`
	RegistrationID string    `json:"registrationId"`
	PanelID        string    `json:"panelId"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ViewTicket はPOST /v1/viewsの応答。ticketはviewがviews.connectで
// 提示する接続credentialで、instanceのlifetime中有効。
type ViewTicket struct {
	ViewInstance
	Ticket string `json:"ticket"`
}

// ViewCreateParams はPOST /v1/viewsの本文。
type ViewCreateParams struct {
	RegistrationID string `json:"registrationId" minLength:"1"`
	PanelID        string `json:"panelId" minLength:"1"`
}

// ViewsConnectParams はview→Coreのviews.connect params。
type ViewsConnectParams struct {
	Ticket string `json:"ticket"`
}

// ViewsConnectResult はviews.connectの応答。bindされたinstanceを返す。
type ViewsConnectResult struct {
	Instance ViewInstance `json:"instance"`
}

// ViewsMessageParams はviews.messageのenvelope。
// payloadはopaqueでCoreは解釈しない（designs/00011）。
type ViewsMessageParams struct {
	Instance string          `json:"instance"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

// views.eventのtype。
const (
	ViewsEventOpened = "opened"
	ViewsEventClosed = "closed"
)

// ViewsEventParams はlifecycle通知。runtimeへはopened/closed両方、
// viewへはruntime死によるclosedが届く。
type ViewsEventParams struct {
	Instance string `json:"instance"`
	Type     string `json:"type"`
	PanelID  string `json:"panelId,omitempty"`
}
