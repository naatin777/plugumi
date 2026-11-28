// マウス操作。View()が構築するhit mapで座標→対象を逆引きする。
// click=フォーカス＋選択、double click=起動・呼び出し・詳細を開く、
// wheel=そのペインのスクロール。キーと同等の経路を必ず残す。
package tui

import (
	"time"

	tea "charm.land/bubbletea/v2"
)

// doubleClickWindow は同じ対象への連続clickを「起動」とみなす間隔。
// teaはダブルクリックイベントをくれないので自前で判定する。
const doubleClickWindow = 400 * time.Millisecond

// hitKind はclickした要素の種別。
type hitKind int

const (
	hitNone hitKind = iota
	hitCore
	hitPlugin
	hitRegistration
	hitTool
)

// mouseTarget は1行に対応するclick対象。
type mouseTarget struct {
	kind  hitKind
	index int
}

// paneHits はペインの占有矩形と、実際に表示された行。
type paneHits struct {
	bounds rect
	rows   []paneRow
}

type rect struct{ x, y, w, h int }

func (r rect) contains(x, y int) bool {
	return x >= r.x && x < r.x+r.w && y >= r.y && y < r.y+r.h
}

// modal中はclickを捨てる。モーダルはstatus行でy/esc応答を待つだけ。
func (m *Model) modalActive() bool {
	return m.confirmCore.ID != "" || m.confirmRemoveRegistrationID != "" ||
		m.addingLaunchCommand || m.detailMode == detailCall
}

func (m *Model) onMouseClick(msg tea.MouseClickMsg) tea.Cmd {
	if msg.Button != tea.MouseLeft || m.modalActive() {
		return nil
	}
	target, hit := m.locateTarget(msg.X, msg.Y)
	if !hit {
		return nil
	}
	m.focusPane(target.pane)
	// ペイン内の空きをclickしてもfocusだけ移す
	if target.kind == hitNone {
		return nil
	}
	double := m.lastClick == target && time.Since(m.lastClickAt) < doubleClickWindow
	m.lastClick = target
	m.lastClickAt = time.Now()
	return m.applyClick(target, double)
}

type locatedTarget struct {
	pane pane
	mouseTarget
}

// locateTarget はペインと行の対象を返す。見出しや余白の行には対象がない。
func (m *Model) locateTarget(x, y int) (locatedTarget, bool) {
	for p, ph := range m.hits {
		if ph.bounds.contains(x, y) {
			return locatedTarget{pane: p, mouseTarget: ph.rows[y-ph.bounds.y].target}, true
		}
	}
	return locatedTarget{}, false
}

func (m *Model) applyClick(target locatedTarget, double bool) tea.Cmd {
	switch target.kind {
	case hitCore:
		var cmd tea.Cmd
		// hoverで選択だけ先行していることがあるため、preview中かどうかは
		// viewedCoreで判定する（選択≠previewの状態があり得る）。
		if target.index < len(m.cores) && m.cores[target.index].URL != m.viewedCore.URL {
			m.coreSelection = target.index
			cmd = m.openCoreView(m.cores[target.index])
		} else {
			m.coreSelection = target.index
		}
		if double {
			m.focusPane(paneDetail)
		}
		return cmd
	case hitPlugin:
		m.pluginSelection = target.index
		if double {
			_, cmd := m.activateSelectedPlugin()
			return cmd
		}
	case hitRegistration:
		m.detailSelection = target.index
		if double {
			m.descendIntoRegistration()
		}
	case hitTool:
		m.detailSelection = target.index
		if double {
			if row, ok := m.selectedRow(); ok && row.operation != nil {
				_, cmd := m.openCall(row)
				return cmd
			}
		}
	}
	return nil
}

// onMouseMotion はhoverで行の選択カーソルを追従させる。
// focusはclickだけが動かし、副作用（Coreのpreview接続など）は発生させない
// — previewはclick・キー移動で開くので、hover後の選択とpreviewがずれうる点に注意。
func (m *Model) onMouseMotion(msg tea.MouseMotionMsg) tea.Cmd {
	if m.modalActive() {
		return nil
	}
	target, hit := m.locateTarget(msg.X, msg.Y)
	if !hit || target.kind == hitNone {
		return nil
	}
	switch target.pane {
	case paneCores:
		if target.index < len(m.cores) {
			m.coreSelection = target.index
		}
	case panePlugins:
		if target.index < len(m.pluginRows) {
			m.pluginSelection = target.index
		}
	case paneDetail:
		if m.detailMode == detailBrowse {
			m.detailSelection = target.index
		}
	}
	return nil
}

func (m *Model) onMouseWheel(msg tea.MouseWheelMsg) tea.Cmd {
	// call中のwheelは出力viewportのスクロールに使うので、確認系だけを塞ぐ。
	if m.confirmCore.ID != "" || m.confirmRemoveRegistrationID != "" || m.addingLaunchCommand {
		return nil
	}
	delta := 0
	switch msg.Button {
	case tea.MouseWheelUp:
		delta = -1
	case tea.MouseWheelDown:
		delta = 1
	default:
		return nil
	}
	target, hit := m.locateTarget(msg.X, msg.Y)
	if !hit {
		return nil
	}
	switch target.pane {
	case paneCores:
		return m.moveCoreFocus(delta)
	case panePlugins:
		m.movePluginFocus(delta)
	case paneDetail:
		switch {
		case m.detailMode == detailCall:
			if delta < 0 {
				m.callChunks.ScrollUp(-delta)
			} else {
				m.callChunks.ScrollDown(delta)
			}
		case m.logView != nil:
			m.scrollLog(delta)
		default:
			m.moveDetailSelection(delta)
		}
	}
	return nil
}
