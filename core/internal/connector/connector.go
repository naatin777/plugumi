// Package connector はCore→Pluginへの接続試行（session.hello）。
// Session確立は起動と分離する — 到達不能なPluginは再試行を続けるだけ
// （docs/contracts/00001「Plugin Endpointの解決」）。
package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const ProtocolVersion = "0.1.0"
const CoreVersion = "0.1.0"

var sessionSeq atomic.Int64
var regSeq atomic.Int64

// Loop は1つのPlugin Endpointへの接続試行。Session確立まで再試行を続ける。
// ctx終了で止まる。
func Loop(ctx context.Context, reg *registry.Registry, endpoint, coreURL string) {
	failed := false
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if _, ok := reg.FindEndpoint(endpoint); !ok {
			if err := hello(reg, endpoint, coreURL); err != nil {
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
func hello(reg *registry.Registry, endpoint, coreURL string) error {
	sess := &registry.Session{
		ID:             fmt.Sprintf("s-%d", sessionSeq.Add(1)),
		RegistrationID: fmt.Sprintf("reg-%d", regSeq.Add(1)),
		Endpoint:       endpoint,
		CreatedAt:      time.Now(),
		LastPing:       time.Now(),
	}
	var req wire.HelloRequest
	req.ProtocolVersion = ProtocolVersion
	req.SessionID = sess.ID
	req.RegistrationID = sess.RegistrationID
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
	var hr wire.HelloResponse
	if err := json.NewDecoder(res.Body).Decode(&hr); err != nil {
		return err
	}
	sess.Plugin = hr.Plugin
	reg.Add(sess)
	log.Printf("[core] session: %s (%s) → %s @ %s", sess.Plugin.ID, sess.ID, sess.RegistrationID, endpoint)
	return nil
}
