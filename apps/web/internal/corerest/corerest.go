// Package corerest はCoreの/v1 REST呼び出しだけを行う（contracts/00004）。
// 状態を持たず、http.Client・token・coreURLは呼び出し側が渡す。
package corerest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

// StatusError はCoreが返したHTTPエラー。
type StatusError struct {
	Status int
}

func (e *StatusError) Error() string { return fmt.Sprintf("HTTP %d", e.Status) }

// CoreInfo はGET /v1/coreの応答。coreIdはCoreの起動ごとに変わる。
type CoreInfo struct {
	CoreID string `json:"coreId"`
	Name   string `json:"name,omitempty"`
}

// Lease は登録・renewの応答。PluginはLeaseSecondsの半分を目安に更新する。
type Lease struct {
	RegistrationID string `json:"registrationId"`
	LeaseSeconds   int    `json:"leaseSeconds"`
}

// FetchCoreInfo はCoreの識別情報を取る。接続前の検査と登録後の取得で共用する。
func FetchCoreInfo(ctx context.Context, client *http.Client, token, coreURL string) (CoreInfo, error) {
	var info CoreInfo
	if err := request(ctx, client, token, http.MethodGet, coreURL, "/core", nil, &info); err != nil {
		return CoreInfo{}, err
	}
	return info, nil
}

// CreateRegistration はproviderIdとinstanceIdで登録する（contracts/00004）。
func CreateRegistration(ctx context.Context, client *http.Client, token, coreURL, pluginID, pluginInstanceID string) (Lease, error) {
	var lease Lease
	err := request(ctx, client, token, http.MethodPost, coreURL, "/registrations",
		map[string]string{"providerId": pluginID, "instanceId": pluginInstanceID}, &lease)
	return lease, err
}

func RenewRegistration(ctx context.Context, client *http.Client, token, coreURL, registrationID string) (Lease, error) {
	var lease Lease
	err := request(ctx, client, token, http.MethodPost, coreURL,
		"/registrations/"+url.PathEscape(registrationID)+"/renew", nil, &lease)
	return lease, err
}

func DeleteRegistration(ctx context.Context, client *http.Client, token, coreURL, registrationID string) error {
	return request(ctx, client, token, http.MethodDelete, coreURL,
		"/registrations/"+url.PathEscape(registrationID), nil, nil)
}

// request は/v1配下のRESTを呼ぶ。bodyを省略するとGET/DELETE相当。
func request(ctx context.Context, client *http.Client, token, method, coreURL, path string, body, result any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, coreURL+"/v1"+path, reader)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, response.Body)
		return &StatusError{Status: response.StatusCode}
	}
	if result != nil {
		return json.NewDecoder(response.Body).Decode(result)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return nil
}

// PanelDeclaration は登録が宣言するUIパネル。
type PanelDeclaration struct {
	PanelID string   `json:"panelId"`
	Title   string   `json:"title"`
	Entry   string   `json:"entry"`
	Styles  []string `json:"styles"`
}

// OperationDeclaration は登録が宣言するoperation。schema等はCore側の
// 完全な宣言にあり、ここでは呼び出し先の選定に必要な部分だけを持つ。
type OperationDeclaration struct {
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
}

// RegistryRegistration はGET /v1/registryの1登録。panelsはUI manifest由来。
// providerKindとtoolsはoperation / Execution modelで廃止（contracts/00004）。
type RegistryRegistration struct {
	RegistrationID string                `json:"registrationId"`
	ProviderID     string                `json:"providerId"`
	Environment    string                `json:"environment,omitempty"`
	Ready          bool                  `json:"ready"`
	Panels         []PanelDeclaration    `json:"panels"`
	UISHA256       string                `json:"uiSha256"`
	RPCAvailable   bool                  `json:"rpcAvailable"`
	Operations     []OperationDeclaration `json:"operations"`
}

// ViewTicket はPOST /v1/viewsの応答。hostがinstance登録し、
// ticketをviewへ渡す（designs/00011）。
type ViewTicket struct {
	ID             string `json:"id"`
	RegistrationID string `json:"registrationId"`
	PanelID        string `json:"panelId"`
	Status         string `json:"status"`
	Ticket         string `json:"ticket"`
}

// CreateViewInstance はview instanceを登録しticketを受け取る。
func CreateViewInstance(ctx context.Context, client *http.Client, token, coreURL, registrationID, panelID string) (ViewTicket, error) {
	var ticket ViewTicket
	err := request(ctx, client, token, http.MethodPost, coreURL, "/views",
		map[string]string{"registrationId": registrationID, "panelId": panelID}, &ticket)
	return ticket, err
}

// CloseViewInstance はview instanceを閉じる（host主導のclose）。
func CloseViewInstance(ctx context.Context, client *http.Client, token, coreURL, viewID string) error {
	return request(ctx, client, token, http.MethodDelete, coreURL, "/views/"+url.PathEscape(viewID), nil, nil)
}

// RegistrySnapshot はGET /v1/registryの応答。
type RegistrySnapshot struct {
	Registrations []RegistryRegistration `json:"registrations"`
}

// FetchRegistry はRegistryのSnapshotを取る（Panel一覧とTool kindの確認に使う）。
func FetchRegistry(ctx context.Context, client *http.Client, token, coreURL string) (RegistrySnapshot, error) {
	var snapshot RegistrySnapshot
	if err := request(ctx, client, token, http.MethodGet, coreURL, "/registry", nil, &snapshot); err != nil {
		return RegistrySnapshot{}, err
	}
	return snapshot, nil
}
