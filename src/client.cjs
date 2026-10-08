// Client half of dsh-warden: the 审查 Tab in the conversation view.
//
// Must stay CommonJS — the build wraps this in window.__ModuleLoader__.load()
// and React is supplied by the harness (esbuild marks it external).

const React = require('react')
const h = React.createElement
const CSS = require('./client-css.cjs')

const API = '/dsh-warden'
const POLL_MS = 1000

// One module-level poller shared by every mounted view. The host half is the
// single source of truth; this side only renders what /dsh-warden/state says.
let snap = { data: null, error: '', at: 0 }
const listeners = new Set()
let timer = null

function emit() {
  Array.from(listeners).forEach(function (fn) {
    try {
      fn(snap)
    } catch (error) {
      // One bad subscriber must not stop the poll.
      if (typeof console !== 'undefined' && console.warn) console.warn('[dsh-warden] listener failed', error)
    }
  })
}

function load() {
  fetch(API + '/state', { headers: { accept: 'application/json' } })
    .then(function (res) { return res.json() })
    .then(function (data) {
      snap = { data: data, error: '', at: Date.now() }
      emit()
    })
    .catch(function (error) {
      snap = { data: snap.data, error: String((error && error.message) || error), at: Date.now() }
      emit()
    })
}

function post(method) {
  return fetch(API + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then(function (res) { return res.json() }).then(function () { load() }).catch(function () {})
}

function subscribe(fn) {
  listeners.add(fn)
  if (timer === null) {
    load()
    timer = setInterval(load, POLL_MS)
  }
  fn(snap)
  return function () {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const CLASS_LABEL = {
  'execute-destructive': '破坏性命令',
  'edit-sensitive': '敏感路径写入',
  'other-destructive': '破坏性载荷',
  'execute': '普通命令',
  'edit': '普通写入',
}

function pad(n) { return n < 10 ? '0' + n : String(n) }

function clock(ms) {
  const d = new Date(ms)
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function Stat(props) {
  return h('div', { className: 'wd-stat' + (props.tone ? ' ' + props.tone : '') },
    h('b', null, String(props.value)),
    h('span', null, props.label),
  )
}

function Row(props) {
  const d = props.d
  const rowCls = d.decision === 'deny' ? 'wd-deny' : (d.error ? 'wd-err' : '')
  const badgeCls = d.decision === 'deny' ? 'wd-deny' : (d.error ? 'wd-err' : (d.decision === 'pass' ? 'wd-pass' : 'wd-allow'))
  const badgeText = d.decision === 'deny' ? '拦截' : (d.error ? '降级放行' : (d.decision === 'pass' ? '直放' : '放行'))
  const meta = [
    CLASS_LABEL[d.cls] || d.cls || '—',
    d.ms ? d.ms + 'ms' : null,
    d.route || null,
  ].filter(Boolean).join(' · ')
  return h('div', { className: 'wd-row ' + rowCls },
    h('div', { className: 'wd-time' }, clock(d.at)),
    h('div', null,
      h('div', { className: 'wd-tool' }, d.tool || '(未知工具)'),
      h('div', { className: 'wd-meta' }, meta),
      d.reason ? h('div', { className: 'wd-reason' }, d.reason) : null,
      d.error ? h('div', { className: 'wd-reason' }, '降级原因：' + d.error) : null,
    ),
    h('span', { className: 'wd-badge ' + badgeCls }, badgeText),
  )
}

function WardenView() {
  const [state, setState] = React.useState(snap)
  React.useEffect(function () { return subscribe(setState) }, [])

  const data = state.data
  const stats = (data && data.stats) || { calls: 0, classified: 0, reviewed: 0, allowed: 0, denied: 0, failed: 0 }
  const rows = (data && data.decisions) || []
  const rules = (data && data.rules) || null

  return h('div', { className: 'wd-root' },
    h('div', { className: 'wd-head' },
      h('div', { className: 'wd-title' }, '审查门'),
      h('div', { className: 'wd-sub' }, '危险动作在执行前由一个独立模型复核'),
      h('div', { className: 'wd-spacer' }),
      h('button', { className: 'wd-btn', type: 'button', onClick: function () { post('reload') } }, '重载规则'),
      h('button', { className: 'wd-btn', type: 'button', onClick: function () { post('clear') } }, '清空'),
    ),
    state.error ? h('div', { className: 'wd-err' }, '与 host 通信失败：' + state.error) : null,
    h('div', { className: 'wd-stats' },
      h(Stat, { label: '工具调用', value: stats.calls }),
      h(Stat, { label: '有风险类别', value: stats.classified }),
      h(Stat, { label: '送审', value: stats.reviewed }),
      h(Stat, { label: '放行', value: stats.allowed, tone: 'wd-good' }),
      h(Stat, { label: '拦截', value: stats.denied, tone: stats.denied > 0 ? 'wd-bad' : '' }),
      h(Stat, { label: '异常降级', value: stats.failed }),
    ),
    rules ? h('div', { className: 'wd-card' },
      h('h4', null, '审查规则' + (rules.source === 'file' ? '（来自文件）' : '（内置默认）')),
      h('div', { className: 'wd-mono' }, rules.path),
      h('div', { className: 'wd-preview' }, rules.preview),
    ) : null,
    h('div', null,
      h('h4', { style: { margin: '0 0 8px', fontSize: '12px', opacity: 0.75 } }, '最近判定'),
      rows.length === 0
        ? h('div', { className: 'wd-empty' }, '暂无记录。出现危险命令或敏感路径写入时，这里会实时显示判定。')
        : h('div', { className: 'wd-list' }, rows.map(function (d, i) {
          return h(Row, { key: String(d.at) + '-' + i, d: d })
        })),
    ),
  )
}

function apply(ctx) {
  // dsh 0.1.6 can unload a plugin at runtime, so every registration here has a
  // matching teardown. The shared poll lives at module scope and therefore
  // outlives one apply(); unmounting the view is not guaranteed on unload, so
  // it needs an explicit disposer of its own.
  ctx.effect(function () {
    return function () {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      listeners.clear()
      snap = { data: null, error: '', at: 0 }
    }
  })

  ctx.effect(function () {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-warden'
    style.textContent = CSS
    document.head.appendChild(style)
    return function () { style.remove() }
  })

  // Guarded, and normalised to always hand Cordis a disposer: a changed slot
  // contract must degrade this one panel and say so, not abort the client boot
  // for every other plugin in the graph.
  ctx.slots.inject('conversation.view', function () {
    let disposeView
    try {
      disposeView = ctx.slots.register(
        { name: 'conversation.view', id: 'warden', order: 30, label: '审查' },
        WardenView,
      )
    } catch (error) {
      disposeView = undefined
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[dsh-warden] could not register the 审查 view; the gate still runs on the host', error)
      }
    }
    return typeof disposeView === 'function' ? disposeView : function () {}
  })
}

module.exports = {
  name: 'dsh-warden',
  inject: ['slots'],
  apply: apply,
}
