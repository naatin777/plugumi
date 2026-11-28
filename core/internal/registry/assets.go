// UI assetのdisk cache（contracts/00004のpull model）。
// 内容はsha256をファイル名としてcacheDirに保持し、in-memoryのindexで
// 参照カウントと最終利用を管理する。Providerからのfetchはassets.goではなく
// fetch.goが担い、ここは保存と配信だけを扱う。
package registry

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const (
	maxUIFiles        = 1000
	maxUIManifestSize = 64 << 20
	maxAssetFileSize  = 16 << 20

	// diskはmemoryと違い安いので、参照されないentryの猶予は長く取る。
	// 起動時scanでrefs=0に戻ったentryも、Providerの再登録を待つ時間がある。
	unreferencedAssetTTL = 24 * time.Hour
)

// panelIDPattern はcore.nameと同じ形。URLにそのまま載る文字だけを許可する。
var panelIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func validUIPath(filePath string) bool {
	if filePath == "" || path.IsAbs(filePath) || path.Clean(filePath) != filePath ||
		strings.ContainsAny(filePath, "\\:?%#") {
		return false
	}
	for _, segment := range strings.Split(filePath, "/") {
		if segment == ".." {
			return false
		}
	}
	return true
}

func validSHA256(hash string) bool {
	if len(hash) != 64 {
		return false
	}
	for _, char := range hash {
		if !('0' <= char && char <= '9') && !('a' <= char && char <= 'f') {
			return false
		}
	}
	return true
}

// assetEntry はcache indexの1 entry。presentは内容がdiskにあるか。
// refsは参照中のUI manifestの数で、内容の有無とは独立に数える
// （宣言はfetchより先に来ることがあるため）。
type assetEntry struct {
	present   bool
	size      int64
	refs      int
	lastTouch time.Time
}

// fetchCallはsingleflight用の進行中fetch。
type fetchCall struct {
	done chan struct{}
	err  error
}

func (r *Registry) assetPath(hash string) string {
	return filepath.Join(r.cacheDir, hash)
}

// scanCache は起動時にcacheDirを読み、indexを構築する。
// entryはrefs=0で始まる。Providerの再宣言で参照が復活するまで、
// unreferencedAssetTTLの猶予で生きる。
func (r *Registry) scanCache() {
	if r.cacheDir == "" {
		return
	}
	if err := os.MkdirAll(r.cacheDir, 0o755); err != nil {
		return
	}
	entries, err := os.ReadDir(r.cacheDir)
	if err != nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	for _, entry := range entries {
		if entry.IsDir() || !validSHA256(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		r.assets[entry.Name()] = &assetEntry{
			present:   true,
			size:      info.Size(),
			lastTouch: now,
		}
	}
}

// HasAsset は内容がcacheにあるかを返す。
func (r *Registry) HasAsset(hash string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, exists := r.assets[hash]
	return exists && entry.present
}

// WriteAsset は内容を検証してcacheへ書く。hashが一致しなければ書かない。
// temp fileへ書いてからrenameし、中途半端なファイルが残らないようにする。
func (r *Registry) WriteAsset(hash string, data []byte) error {
	if len(data) > maxAssetFileSize {
		return errors.New("asset exceeds 16 MiB")
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != hash {
		return errors.New("content does not match the declared sha256")
	}
	if r.cacheDir == "" {
		return errors.New("no cache directory configured")
	}
	if err := os.MkdirAll(r.cacheDir, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(r.cacheDir, "tmp-*")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		os.Remove(tempName)
		return err
	}
	if err := temp.Close(); err != nil {
		os.Remove(tempName)
		return err
	}
	r.mu.Lock()
	entry := r.assets[hash]
	if entry == nil {
		entry = &assetEntry{}
		r.assets[hash] = entry
	}
	entry.present = true
	entry.size = int64(len(data))
	entry.lastTouch = r.now()
	r.mu.Unlock()
	if err := os.Rename(tempName, r.assetPath(hash)); err != nil {
		os.Remove(tempName)
		return err
	}
	return nil
}

// ReadAsset はcacheから内容を読む。presentでなければfalseを返す。
func (r *Registry) ReadAsset(hash string) ([]byte, bool) {
	r.mu.Lock()
	entry, exists := r.assets[hash]
	if !exists || !entry.present {
		r.mu.Unlock()
		return nil, false
	}
	entry.lastTouch = r.now()
	r.mu.Unlock()
	data, err := os.ReadFile(r.assetPath(hash))
	if err != nil {
		// indexとdiskが食い違った場合はindex側を落として次回fetchを促す
		r.mu.Lock()
		if current := r.assets[hash]; current != nil {
			current.present = false
		}
		r.mu.Unlock()
		return nil, false
	}
	return data, true
}

// ReplaceUI は登録のUI manifestを全置換する。filesとpanelsが両方空ならUI解除。
// pull modelでは宣言時に内容の存在を要求しない。fetchはfetch.goが担う。
// 同じ内容の再送は変更通知を出さない（ReplaceOperationsと同じ扱い）。
func (r *Registry) ReplaceUI(registrationID string, manifest wire.UIManifest) error {
	files := manifest.Files
	if files == nil {
		files = []wire.UIFile{}
	}
	panels := manifest.Panels
	if panels == nil {
		panels = []wire.PanelDeclaration{}
	}
	if len(files) > maxUIFiles {
		return ErrInvalidUI
	}
	paths := make(map[string]bool, len(files))
	total := int64(0)
	for _, file := range files {
		if !validUIPath(file.Path) || paths[file.Path] || !validSHA256(file.SHA256) {
			return ErrInvalidUI
		}
		if file.Size > maxAssetFileSize {
			return ErrInvalidUI
		}
		total += file.Size
		paths[file.Path] = true
	}
	if total > maxUIManifestSize {
		return ErrInvalidUI
	}
	panelIDs := make(map[string]bool, len(panels))
	for _, panel := range panels {
		if !panelIDPattern.MatchString(panel.PanelID) || panelIDs[panel.PanelID] ||
			strings.TrimSpace(panel.Title) == "" || !paths[panel.Entry] {
			return ErrInvalidUI
		}
		panelIDs[panel.PanelID] = true
		stylePaths := make(map[string]bool, len(panel.Styles))
		for _, style := range panel.Styles {
			if !paths[style] || stylePaths[style] {
				return ErrInvalidUI
			}
			stylePaths[style] = true
		}
	}
	r.mu.Lock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		r.mu.Unlock()
		return ErrUnknownRegistration
	}
	changed := !slices.EqualFunc(record.files, files, func(first, second wire.UIFile) bool {
		return first == second
	}) || !slices.EqualFunc(record.panels, panels, func(first, second wire.PanelDeclaration) bool {
		return first.PanelID == second.PanelID && first.Title == second.Title &&
			first.Entry == second.Entry && slices.Equal(first.Styles, second.Styles)
	})
	if !changed {
		r.mu.Unlock()
		return nil
	}
	r.releaseFilesLocked(record.files)
	for _, file := range files {
		entry := r.assets[file.SHA256]
		if entry == nil {
			entry = &assetEntry{}
			r.assets[file.SHA256] = entry
		}
		entry.refs++
		entry.lastTouch = r.now()
	}
	record.files = files
	record.panels = panels
	record.uiSHA256 = uiManifestSHA256(files, panels)
	r.publishLocked("panels.changed")
	r.mu.Unlock()
	// prefetchはnetwork IOを伴うのでlockの外で起動する
	go r.PrefetchUIAssets(registrationID)
	return nil
}

// uiManifestSHA256 はfiles(path順)とpanelsを正規化したJSONのsha256。
// UIが無ければ空文字を返す。内容が1バイトでも変われば変わる。
func uiManifestSHA256(files []wire.UIFile, panels []wire.PanelDeclaration) string {
	if len(files) == 0 && len(panels) == 0 {
		return ""
	}
	sorted := slices.Clone(files)
	slices.SortFunc(sorted, func(first, second wire.UIFile) int {
		return cmp.Compare(first.Path, second.Path)
	})
	normalized, _ := json.Marshal(struct {
		Files  []wire.UIFile           `json:"files"`
		Panels []wire.PanelDeclaration `json:"panels"`
	}{Files: sorted, Panels: panels})
	sum := sha256.Sum256(normalized)
	return hex.EncodeToString(sum[:])
}

// UIAssetRef は登録のmanifestがpathに対して宣言するsha256を返す。
func (r *Registry) UIAssetRef(registrationID, filePath string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		return "", false
	}
	for _, file := range record.files {
		if file.Path == filePath {
			return file.SHA256, true
		}
	}
	return "", false
}

// releaseFilesLocked はmanifestの参照を外す。lastTouchを更新するのは、
// 参照が外れた時点から猶予を数えるため（長く参照されていたassetが
// 外れた瞬間に即削除されるのを防ぐ）。
func (r *Registry) releaseFilesLocked(files []wire.UIFile) {
	for _, file := range files {
		entry := r.assets[file.SHA256]
		if entry == nil {
			continue
		}
		entry.refs--
		if entry.refs < 0 {
			entry.refs = 0
		}
		entry.lastTouch = r.now()
	}
}

// collectStaleAssetsLocked は参照されないままTTLを超えたentryを消す。
func (r *Registry) collectStaleAssetsLocked(now time.Time) {
	for hash, entry := range r.assets {
		if entry.refs == 0 && now.Sub(entry.lastTouch) > unreferencedAssetTTL {
			delete(r.assets, hash)
			if entry.present && r.cacheDir != "" {
				_ = os.Remove(r.assetPath(hash))
			}
		}
	}
}

// ---- fetch orchestration（pull modelの中核） ----

// FetchAsset は登録のmanifestで宣言されたpathの内容をProviderから取得する。
// 既にcacheにあれば何もしない。singleflightで同じhashの同時fetchは1つにまとめる。
func (r *Registry) FetchAsset(ctx context.Context, registrationID, filePath string) error {
	hash, declared := r.UIAssetRef(registrationID, filePath)
	if !declared {
		return errors.New("no such UI asset in the manifest")
	}
	if r.HasAsset(hash) {
		return nil
	}

	// singleflight: 同じhashのfetchが進行中ならそれを待つ
	r.fetchMu.Lock()
	if call := r.fetches[hash]; call != nil {
		r.fetchMu.Unlock()
		select {
		case <-call.done:
			return call.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	call := &fetchCall{done: make(chan struct{})}
	r.fetches[hash] = call
	r.fetchMu.Unlock()

	err := r.fetchAssetInner(ctx, registrationID, filePath, hash)

	r.fetchMu.Lock()
	call.err = err
	close(call.done)
	delete(r.fetches, hash)
	r.fetchMu.Unlock()
	return err
}

func (r *Registry) fetchAssetInner(ctx context.Context, registrationID, filePath, hash string) error {
	r.mu.Lock()
	record := r.liveLocked(registrationID, r.now())
	var connection *rpc.Connection
	if record != nil {
		connection = record.connection
	}
	r.mu.Unlock()
	if connection == nil {
		return errors.New("provider is not connected")
	}

	fetchCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	res, err := connection.Request(fetchCtx, wire.MethodAssetsGet, wire.AssetsGetParams{
		Path:   filePath,
		SHA256: hash,
	})
	if err != nil {
		return fmt.Errorf("assets.get failed: %w", err)
	}
	if res.Error != nil {
		return fmt.Errorf("provider returned error: %s", res.Error.Message)
	}
	var result wire.AssetsGetResult
	if err := wire.Unmarshal(res.Result, &result); err != nil {
		return errors.New("invalid assets.get response")
	}
	data, err := base64.StdEncoding.DecodeString(result.Content)
	if err != nil {
		return errors.New("invalid base64 content")
	}
	if err := r.WriteAsset(hash, data); err != nil {
		return err
	}
	return nil
}

// PrefetchUIAssets は登録のmanifestで宣言されcacheに無いファイルを先行取得する。
// 失敗してもfatalではない（lazy fetchがGET /v1/uiで再度試みる）。
func (r *Registry) PrefetchUIAssets(registrationID string) {
	r.mu.Lock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil || record.connection == nil {
		r.mu.Unlock()
		return
	}
	paths := make([]string, 0, len(record.files))
	for _, file := range record.files {
		paths = append(paths, file.Path)
	}
	r.mu.Unlock()

	for _, filePath := range paths {
		hash, declared := r.UIAssetRef(registrationID, filePath)
		if !declared || r.HasAsset(hash) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		_ = r.FetchAsset(ctx, registrationID, filePath)
		cancel()
	}
}
