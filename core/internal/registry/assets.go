// UI assetストア（contracts/00004のUI配信部分）。
// sha256を内容アドレスとして参照カウントとTTLで管理する。
package registry

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/naatin777/plugumi/core/internal/wire"
)

// MissingAssetsError はUI manifestが参照する未アップロードのsha256一覧。
type MissingAssetsError struct {
	Hashes []string
}

func (e *MissingAssetsError) Error() string {
	return "missing assets: " + strings.Join(e.Hashes, ", ")
}

// asset はsha256をキーにメモリに1つだけ持つファイル本体。
// refsは参照中のUI manifestの数。参照が0になった時点・または参照されないまま
// unreferencedAssetTTLを超えた時点で破棄する。
type asset struct {
	data       []byte
	uploadedAt time.Time
	refs       int
}

// ---- UI assets（contracts/00004のUI配信部分） ----

const (
	maxUIFiles        = 1000
	maxUIManifestSize = 64 << 20
)

// panelIDPattern はcore.nameと同じ形。URLにそのまま載る文字だけを許可する。
var panelIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// validUIPath はmanifestのpathを検査する。GET /v1/uiのパスと一致する形
// （相対・正規化済み・URL上で安全な文字のみ）だけを許可する。
func validUIPath(filePath string) bool {
	if filePath == "" || path.IsAbs(filePath) || path.Clean(filePath) != filePath ||
		strings.ContainsAny(filePath, "\\:?%#") {
		return false
	}
	// Cleanは".."を消さないので、segmentごとに確かめる。
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

// MissingAssets はCoreが持っていないsha256を入力順で返す。
func (r *Registry) MissingAssets(hashes []string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	missing := []string{}
	for _, hash := range hashes {
		if _, exists := r.assets[hash]; !exists {
			missing = append(missing, hash)
		}
	}
	return missing
}

// PutAsset はファイル本体を記録する。sha256照合は呼び出し側が済ませる。
// 既に参照されている同ハッシュがあっても内容は同一なので、保持期限だけ更新する。
func (r *Registry) PutAsset(hash string, data []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if stored, exists := r.assets[hash]; exists {
		stored.uploadedAt = r.now()
		return
	}
	r.assets[hash] = &asset{data: data, uploadedAt: r.now()}
}

// ReplaceUI は登録のUI manifestを全置換する。filesとpanelsが両方空ならUI解除。
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
	for _, file := range files {
		if !validUIPath(file.Path) || paths[file.Path] || !validSHA256(file.SHA256) {
			return ErrInvalidUI
		}
		paths[file.Path] = true
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
	defer r.mu.Unlock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		return ErrUnknownRegistration
	}
	var missing []string
	total := 0
	for _, file := range files {
		stored, exists := r.assets[file.SHA256]
		if !exists {
			missing = append(missing, file.SHA256)
			continue
		}
		total += len(stored.data)
	}
	if len(missing) > 0 {
		return &MissingAssetsError{Hashes: missing}
	}
	if total > maxUIManifestSize {
		return ErrInvalidUI
	}
	changed := !slices.EqualFunc(record.files, files, func(first, second wire.UIFile) bool {
		return first == second
	}) || !slices.EqualFunc(record.panels, panels, func(first, second wire.PanelDeclaration) bool {
		return first.PanelID == second.PanelID && first.Title == second.Title &&
			first.Entry == second.Entry && slices.Equal(first.Styles, second.Styles)
	})
	if !changed {
		return nil
	}
	r.releaseFilesLocked(record.files)
	for _, file := range files {
		r.assets[file.SHA256].refs++
	}
	record.files = files
	record.panels = panels
	record.uiSHA256 = uiManifestSHA256(files, panels)
	r.publishLocked("panels.changed")
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

// UIAsset は登録のUI fileを返す。配信はsha256照合済みの内容をそのまま返す。
func (r *Registry) UIAsset(registrationID, filePath string) (string, []byte, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		return "", nil, false
	}
	for _, file := range record.files {
		if file.Path == filePath {
			if stored, exists := r.assets[file.SHA256]; exists {
				return file.SHA256, stored.data, true
			}
		}
	}
	return "", nil, false
}

// releaseFilesLocked はmanifestの参照を外す。参照が0になってもuploadedAtから
// unreferencedAssetTTL以内は削除をsweeperに任せる（別の登録が同じハッシュを
// アップロード直後に旧manifest側の解放で消され、missing_assetsになる競合を防ぐ）。
func (r *Registry) releaseFilesLocked(files []wire.UIFile) {
	for _, file := range files {
		stored, exists := r.assets[file.SHA256]
		if !exists {
			continue
		}
		stored.refs--
		if stored.refs <= 0 && r.now().Sub(stored.uploadedAt) > unreferencedAssetTTL {
			delete(r.assets, file.SHA256)
		}
	}
}

// collectStaleAssetsLocked は参照されないままTTLを超えたassetを消す。
func (r *Registry) collectStaleAssetsLocked(now time.Time) {
	for hash, stored := range r.assets {
		if stored.refs == 0 && now.Sub(stored.uploadedAt) > unreferencedAssetTTL {
			delete(r.assets, hash)
		}
	}
}
