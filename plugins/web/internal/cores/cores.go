// Package cores は接続先Core一覧と、各Coreへの登録・Lease更新を管理する
// （contracts/00004のPlugin側登録処理。WS・SSE購読は持たない）。
// REST呼び出し自体はcorerestが担う。
package cores

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/naatin777/plugumi/plugins/web/internal/corerest"
)

// Source はCore一覧への追加経路。commandは起動引数由来でUIから削除できない。
type Source string

const (
	SourceCommand Source = "command"
	SourceSaved   Source = "saved"
)

type Status string

const (
	StatusConnecting  Status = "connecting"
	StatusConnected   Status = "connected"
	StatusRejected    Status = "rejected"
	StatusUnreachable Status = "unreachable"
)

// Core はGET /api/coresの一覧要素。keyはURLの一部として使う識別子で、
// core.nameがあればname、なければcoreId、どちらも未取得なら空。
type Core struct {
	URL    string `json:"url"`
	Source Source `json:"source"`
	CoreID string `json:"coreId"`
	Name   string `json:"name"`
	Key    string `json:"key"`
	Status Status `json:"status"`
	Error  string `json:"error,omitempty"`
}

// NormalizeURL はCoreの待受URLをhttp://host:portの形に正規化する。
// ブラウザ経由で外部へ出ないようloopbackに限定する（core側configと同じ条件）。
func NormalizeURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	invalid := fmt.Errorf("Core URL must be an http://<host>:<port> URL")
	if err != nil || parsed.Scheme != "http" ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.ForceQuery || parsed.RawQuery != "" || strings.Contains(rawURL, "#") {
		return "", invalid
	}
	port, err := strconv.ParseUint(parsed.Port(), 10, 16)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return "", invalid
	}
	host := parsed.Hostname()
	if host != "localhost" {
		addr := net.ParseIP(host)
		if addr == nil || !addr.IsLoopback() {
			return "", fmt.Errorf("Core URL must be a loopback address (got %q)", rawURL)
		}
	}
	return "http://" + net.JoinHostPort(host, strconv.FormatUint(port, 10)), nil
}

// ReservedName はWeb Plugin自身がパスの先頭に使う名前かを返す（/api/、Viteの/assets/）。
// Coreの設定で禁止しないのは、これがWeb Plugin側だけの都合だから（designs/00004）。
func ReservedName(name string) bool {
	return name == "api" || name == "assets" || name == "ui"
}

// Manager は全Coreへの接続を管理する。
type Manager struct {
	pluginInstanceID string
	token            string
	client           *http.Client
	mu               sync.Mutex
	cores            map[string]*trackedCore
}

func NewManager(pluginInstanceID, token string) *Manager {
	return &Manager{
		pluginInstanceID: pluginInstanceID,
		token:            token,
		client:           &http.Client{Timeout: 10 * time.Second},
		cores:            map[string]*trackedCore{},
	}
}

// Add は正規化済みURLのCoreへの接続を開始する。既にあるURLは追加しない。
func (m *Manager) Add(normalizedURL string, source Source) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.cores[normalizedURL]; exists {
		return fmt.Errorf("Core at %s is already registered", normalizedURL)
	}
	ctx, cancel := context.WithCancel(context.Background())
	tracked := &trackedCore{url: normalizedURL, source: source, status: StatusConnecting, cancel: cancel, done: make(chan struct{})}
	m.cores[normalizedURL] = tracked
	go tracked.run(ctx, m)
	return nil
}

// SetInfo はPOST時の事前検査で取得済みの識別情報を記録する。
// 登録完了時にもGET /v1/coreを取り直すため、ここは表示と重複検査の速さのためだけ。
func (m *Manager) SetInfo(normalizedURL string, info corerest.CoreInfo) {
	m.mu.Lock()
	tracked, exists := m.cores[normalizedURL]
	m.mu.Unlock()
	if exists {
		tracked.setState(StatusConnecting, info.CoreID, info.Name, "")
	}
}

// Remove は接続を止めて登録を削除する。
func (m *Manager) Remove(normalizedURL string) {
	m.mu.Lock()
	tracked, exists := m.cores[normalizedURL]
	delete(m.cores, normalizedURL)
	m.mu.Unlock()
	if !exists {
		return
	}
	tracked.cancel()
	<-tracked.done
}

// Close は全Coreとの接続を止める。
func (m *Manager) Close() {
	m.mu.Lock()
	tracked := make([]*trackedCore, 0, len(m.cores))
	for _, core := range m.cores {
		tracked = append(tracked, core)
	}
	m.cores = map[string]*trackedCore{}
	m.mu.Unlock()
	for _, core := range tracked {
		core.cancel()
	}
	for _, core := range tracked {
		<-core.done
	}
}

func (m *Manager) Get(normalizedURL string) (Core, bool) {
	m.mu.Lock()
	tracked, exists := m.cores[normalizedURL]
	m.mu.Unlock()
	if !exists {
		return Core{}, false
	}
	return tracked.snapshot(), true
}

// FindByKey はnameまたはcoreIdが一致するCoreを返す。
func (m *Manager) FindByKey(key string) (Core, bool) {
	for _, core := range m.List() {
		if core.Key != "" && core.Key == key {
			return core, true
		}
	}
	return Core{}, false
}

func (m *Manager) List() []Core {
	m.mu.Lock()
	tracked := make([]*trackedCore, 0, len(m.cores))
	for _, core := range m.cores {
		tracked = append(tracked, core)
	}
	m.mu.Unlock()
	cores := make([]Core, 0, len(tracked))
	for _, core := range tracked {
		cores = append(cores, core.snapshot())
	}
	slices.SortFunc(cores, func(first, second Core) int { return strings.Compare(first.URL, second.URL) })
	return cores
}

// NameTaken はURLの異なる登録済みCoreが同名かを調べる（新規追加時の重複検査用）。
func (m *Manager) NameTaken(name, excludeURL string) (Core, bool) {
	for _, core := range m.List() {
		if core.URL != excludeURL && core.Name != "" && core.Name == name {
			return core, true
		}
	}
	return Core{}, false
}

// trackedCore は1つのCoreへの接続状態。
type trackedCore struct {
	url    string
	source Source
	cancel context.CancelFunc
	done   chan struct{}

	mu             sync.Mutex
	coreID         string
	name           string
	status         Status
	errorMessage   string
	registrationID string
}

func (t *trackedCore) snapshot() Core {
	t.mu.Lock()
	defer t.mu.Unlock()
	key := t.name
	if key == "" {
		key = t.coreID
	}
	if ReservedName(key) {
		key = ""
	}
	return Core{
		URL: t.url, Source: t.source, CoreID: t.coreID, Name: t.name,
		Key: key, Status: t.status, Error: t.errorMessage,
	}
}

func (t *trackedCore) setState(status Status, coreID, name, errorMessage string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if coreID != "" {
		t.coreID = coreID
	}
	if name != "" || status == StatusConnected {
		t.name = name
	}
	t.status = status
	t.errorMessage = errorMessage
}

// run はagentのCoreClient.runと同じく、登録・更新の繰り返しと
// 指数backoffによる再接続を行う。401/403/426は再試行しない（rejected）。
func (t *trackedCore) run(ctx context.Context, m *Manager) {
	defer close(t.done)
	defer t.deleteRegistration(m)
	backoff := 250 * time.Millisecond
	for ctx.Err() == nil {
		// 一度つながったら、次の切断からは短い間隔で再試行し直す。
		err := t.session(ctx, m, func() { backoff = 250 * time.Millisecond })
		if ctx.Err() != nil {
			return
		}
		var httpErr *corerest.StatusError
		if errors.As(err, &httpErr) && (httpErr.Status == http.StatusUnauthorized ||
			httpErr.Status == http.StatusForbidden || httpErr.Status == http.StatusUpgradeRequired) {
			t.setState(StatusRejected, "", "", err.Error())
			return
		}
		t.setState(StatusUnreachable, "", "", err.Error())
		timer := time.NewTimer(backoff + time.Duration(rand.Int64N(backoff.Nanoseconds()/4)))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 5*time.Second {
			backoff *= 2
		}
	}
}

// session は登録からLease更新までの1区間。登録を失ったら戻って再登録する。
func (t *trackedCore) session(ctx context.Context, m *Manager, connected func()) error {
	lease, err := corerest.CreateRegistration(ctx, m.client, m.token, t.url, "web", m.pluginInstanceID)
	if err != nil {
		return err
	}
	t.mu.Lock()
	t.registrationID = lease.RegistrationID
	t.mu.Unlock()
	info, err := corerest.FetchCoreInfo(ctx, m.client, m.token, t.url)
	if err != nil {
		return err
	}
	// Core再起動でcoreIdは変わるので、登録のたびに取り直して保持する。
	t.setState(StatusConnected, info.CoreID, info.Name, "")
	connected()
	renewInterval := time.Duration(lease.LeaseSeconds) * time.Second / 2
	if renewInterval <= 0 {
		renewInterval = time.Second
	}
	timer := time.NewTimer(renewInterval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
		renewed, err := corerest.RenewRegistration(ctx, m.client, m.token, t.url, t.registrationID)
		if err != nil {
			return err
		}
		timer.Reset(time.Duration(renewed.LeaseSeconds) * time.Second / 2)
	}
}

func (t *trackedCore) deleteRegistration(m *Manager) {
	t.mu.Lock()
	registrationID := t.registrationID
	t.mu.Unlock()
	if registrationID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	_ = corerest.DeleteRegistration(ctx, m.client, m.token, t.url, registrationID)
}
