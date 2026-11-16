// Package connector はCore→Pluginへの接続試行（session.hello）。
// Session確立は起動と分離する — 到達不能なPluginは再試行を続けるだけ
// （docs/contracts/00001「Plugin Endpointの解決」）。
package connector

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const ProtocolVersion = "0.1.0"
const CoreVersion = "0.1.0"

// newID はUUIDv4形式のランダムIDをprefix付きで発行する。
// 逐次カウンターにしない理由: hello失敗でIDが消費されるのを避けるのと、
// SessionがCore再起動・複数Core間で実質一意であってほしいため。
func newID(prefix string) string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	s := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s%s-%s-%s-%s-%s", prefix, s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
}

// Loop は1つのPlugin Endpointへの接続試行。Session確立まで再試行を続ける。
// ctx終了で止まる。
func Loop(ctx context.Context, sessions *registry.Registry, endpoint, coreURL string) {
	failed := false
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if _, ok := sessions.FindEndpoint(endpoint); !ok {
			if err := hello(sessions, endpoint, coreURL); err != nil {
				if !failed {
					log.Printf("[core] plugin %s unreachable: %v (retrying)", endpoint, err)
					failed = true
				}
			} else {
				failed = false
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

// hello は session.hello（Core → Plugin）。IDを払い出してSessionを登録する。
func hello(sessions *registry.Registry, endpoint, coreURL string) error {
	session := &registry.Session{
		ID:             newID("s-"),
		RegistrationID: newID("reg-"),
		Endpoint:       endpoint,
		CreatedAt:      time.Now(),
	}
	session.Touch() // 失効判定の基準時刻を登録直後に合わせる
	var req wire.HelloRequest
	req.ProtocolVersion = ProtocolVersion
	req.SessionID = session.ID
	req.RegistrationID = session.RegistrationID
	req.Core.URL = coreURL
	req.Core.Version = CoreVersion

	body, _ := json.Marshal(req)
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Post(endpoint+"/v1/session/hello", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("hello: %s", res.Status)
	}
	var helloResponse wire.HelloResponse
	if err := json.NewDecoder(res.Body).Decode(&helloResponse); err != nil {
		return err
	}
	session.Plugin = helloResponse.Plugin
	sessions.Add(session)
	log.Printf("[core] session: %s (%s) → %s @ %s", session.Plugin.ID, session.ID, session.RegistrationID, endpoint)
	return nil
}
