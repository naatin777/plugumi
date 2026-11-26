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
		map[string]string{"providerId": pluginID, "instanceId": pluginInstanceID, "providerKind": "host"}, &lease)
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

// RegistryRegistration はGET /v1/registryの1登録。panelsはUI manifest由来。
type RegistryRegistration struct {
	RegistrationID string             `json:"registrationId"`
	ProviderID     string             `json:"providerId"`
	Kind           string             `json:"providerKind"`
	Panels         []PanelDeclaration `json:"panels"`
	UISHA256       string             `json:"uiSha256"`
	RPCAvailable   bool               `json:"rpcAvailable"`
	Tools          []struct {
		ToolPath string `json:"toolPath"`
		Kind     string `json:"kind"`
	} `json:"tools"`
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
