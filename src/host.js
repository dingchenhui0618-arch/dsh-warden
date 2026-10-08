// Host half of dsh-warden.
//
// Wires into the one hook point DeepSeek Harness offers plugins before a tool
// runs:
//
//   tools/pre-execute  ->  { kind: 'allow' } | { kind: 'deny', reason } | { kind: 'ask' }
//
// This plugin never answers 'ask'. When approval prompts are disabled an 'ask'
// degrades to a denial, so an undecided reviewer would silently kill ordinary
// work. It answers allow or deny, and it fails open on every error path.

import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { classify, describeClass, shouldReview } from './classify.js'
import { DEFAULT_RULES, RULES_FILENAME } from './rules.js'

export const name = 'dsh-warden'
export const inject = ['webServer']

const MAX_DECISIONS = 200
const AUDIT_KEEP = 60

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = ''
    req.on('data', function (chunk) {
      raw += chunk
      if (raw.length > 1048576) req.destroy()
    })
    req.on('end', function () {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {})
      } catch (error) {
        resolve({})
      }
    })
    req.on('error', function () {
      resolve({})
    })
  })
}

function methodFromUrl(url) {
  const path = String(url || '').split('?')[0]
  const rest = path.replace(/^\/dsh-warden\/?/, '')
  return rest || 'state'
}

function safeStringify(value) {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : ''
  } catch (error) {
    return ''
  }
}

function excerpt(text, max) {
  return text.length > max ? text.slice(0, max) + ' …' : text
}

function parseJsonObject(text) {
  if (typeof text !== 'string') return undefined
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch (error) {
    return undefined
  }
}

export function apply(ctx, config) {
  const settings = config && typeof config === 'object' ? config : {}
  const home = typeof settings.dshHome === 'string' ? settings.dshHome : dshHome()
  const rulesPath = typeof settings.rulesPath === 'string' ? settings.rulesPath : join(home, RULES_FILENAME)
  const auditPath = typeof settings.auditPath === 'string' ? settings.auditPath : join(home, 'warden-audit.jsonl')

  const stats = { calls: 0, classified: 0, reviewed: 0, allowed: 0, denied: 0, failed: 0 }
  const decisions = []

  let rulesCache = { mtime: -1, text: DEFAULT_RULES, source: 'builtin' }

  // Rules are re-read whenever the file's mtime moves, so editing
  // $DSH_HOME/adversary.md takes effect without restarting the harness.
  function loadRules() {
    let info
    try {
      info = statSync(rulesPath)
    } catch (error) {
      if (rulesCache.source !== 'builtin') rulesCache = { mtime: -1, text: DEFAULT_RULES, source: 'builtin' }
      return rulesCache
    }
    if (info.mtimeMs === rulesCache.mtime && rulesCache.source === 'file') return rulesCache
    try {
      const text = readFileSync(rulesPath, 'utf8').trim()
      rulesCache = {
        mtime: info.mtimeMs,
        text: text.length > 0 ? text : DEFAULT_RULES,
        source: text.length > 0 ? 'file' : 'builtin',
      }
    } catch (error) {
      rulesCache = { mtime: -1, text: DEFAULT_RULES, source: 'builtin' }
    }
    return rulesCache
  }

  // The in-memory ring keeps the panel useful; the JSONL file is the durable
  // record. Only reviewed calls are persisted — auditing every ordinary shell
  // command would bury the interesting lines.
  function record(entry) {
    decisions.push(entry)
    if (decisions.length > MAX_DECISIONS) decisions.splice(0, decisions.length - MAX_DECISIONS)
    if (entry.reviewed !== true) return
    try {
      appendFileSync(auditPath, JSON.stringify(entry) + '\n')
    } catch (error) {
      // An unwritable audit file must never affect a tool call.
    }
  }

  function currentSelection() {
    const models = ctx.get('agentDefaultModel')
    if (models === undefined) return undefined
    try {
      const selection = models.currentSelection()
      if (selection && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
      }
    } catch (error) {
      return undefined
    }
    return undefined
  }

  async function firstRoute(llm) {
    try {
      const providers = llm.listProviders()
      for (const entry of providers) {
        const models = await llm.listModels(entry.id)
        if (models.length > 0) return { provider: entry.id, model: models[0].id }
      }
    } catch (error) {
      return undefined
    }
    return undefined
  }

  function objectiveOf(exec) {
    const goals = ctx.get('goals')
    if (goals === undefined || exec.agent === undefined) return undefined
    try {
      const view = goals.get(exec.agent)
      if (view === undefined || typeof view.objective !== 'string') return undefined
      return view.objective
    } catch (error) {
      return undefined
    }
  }

  async function judge(exec, cls, rules) {
    const llm = ctx.get('llm')
    if (llm === undefined) return { failed: 'no-llm' }
    let selection = currentSelection()
    if (selection === undefined) selection = await firstRoute(llm)
    if (selection === undefined) return { failed: 'no-route' }

    const lines = [
      '工具名称：' + String(exec.name),
      '风险类别：' + describeClass(cls),
      '调用参数：' + excerpt(safeStringify(exec.arguments), 1200),
    ]
    const objective = objectiveOf(exec)
    if (objective !== undefined) lines.push('当前会话目标：' + excerpt(objective, 400))

    const options = {
      provider: selection.provider,
      model: selection.model,
      system: rules.text,
      messages: [{
        id: 'warden-' + String(exec.callId),
        role: 'user',
        content: [{ type: 'text', text: lines.join('\n') }],
        source: { kind: 'plugin', plugin: 'warden' },
      }],
      temperature: 0,
      maxTokens: 160,
    }
    if (selection.reasoningEffort) options.reasoningEffort = selection.reasoningEffort
    if (exec.signal !== undefined) options.signal = exec.signal

    // Model-side failures surface as a terminating finish chunk, not as a
    // thrown exception. Both paths must be handled, and both must allow.
    let out = ''
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta' && chunk.text) {
        out += chunk.text
      } else if (chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        const message = chunk.reason.failure && chunk.reason.failure.message
        return { failed: message || ('finish ' + chunk.reason.kind) }
      }
    }

    const parsed = parseJsonObject(out)
    if (parsed === undefined) return { failed: 'unparsed', raw: excerpt(out, 300) }
    return { verdict: parsed, route: selection.provider + '/' + selection.model }
  }

  ctx.on('tools/pre-execute', async function (exec, next) {
    const started = Date.now()
    try {
      stats.calls = stats.calls + 1
      const raw = safeStringify(exec.arguments)
      const cls = classify(exec.name, raw)
      if (cls === undefined) return next()
      stats.classified = stats.classified + 1

      if (!shouldReview(cls)) {
        record({ at: started, tool: String(exec.name), cls: cls, reviewed: false, decision: 'pass', ms: 0 })
        return next()
      }
      if (exec.signal !== undefined && exec.signal.aborted === true) return next()

      stats.reviewed = stats.reviewed + 1
      const result = await judge(exec, cls, loadRules())
      const ms = Date.now() - started

      if (result.failed !== undefined) {
        stats.failed = stats.failed + 1
        record({
          at: started, tool: String(exec.name), cls: cls, reviewed: true,
          decision: 'allow', error: result.failed, raw: result.raw, ms: ms,
        })
        return next()
      }

      const verdict = result.verdict
      if (verdict && verdict.allow === false) {
        const reason = typeof verdict.reason === 'string' && verdict.reason.length > 0
          ? verdict.reason
          : '审查模型认为该操作与当前目标不符'
        stats.denied = stats.denied + 1
        record({
          at: started, tool: String(exec.name), cls: cls, reviewed: true,
          decision: 'deny', reason: reason, route: result.route, ms: ms,
        })
        return { kind: 'deny', reason: '[warden] ' + reason }
      }

      stats.allowed = stats.allowed + 1
      record({
        at: started, tool: String(exec.name), cls: cls, reviewed: true,
        decision: 'allow', route: result.route, ms: ms,
      })
      return next()
    } catch (error) {
      stats.failed = stats.failed + 1
      try {
        record({
          at: started, tool: String(exec && exec.name), reviewed: true,
          decision: 'allow', error: String((error && error.message) || error), ms: Date.now() - started,
        })
      } catch (inner) {
        // never let the audit path break a tool call
      }
      return next()
    }
  })

  // Every registration in this file is unwound on unload: ctx.on belongs to the
  // fiber, and the route below keeps an explicit disposer. dsh 0.1.6 resolves
  // plugin dependencies at runtime and can unload a plugin mid-session, which
  // makes an un-unloadable registration a real defect rather than a tidy-up.
  //
  // The panel is the disposable half of the plugin. If the route cannot be
  // registered — a changed webServer contract, a host with no web server — the
  // review gate itself must keep working, so the failure is contained here
  // instead of being allowed to abort apply() and take the gate down with it.
  ctx.effect(function () {
    let disposeRoute
    try {
      disposeRoute = ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-warden',
        handler: async function (req, res) {
          try {
            const method = methodFromUrl(req.url)
            if (req.method === 'GET' || method === 'state') {
              const rules = loadRules()
              sendJson(res, 200, {
                stats: stats,
                decisions: decisions.slice(-AUDIT_KEEP).reverse(),
                rules: {
                  path: rulesPath,
                  source: rules.source,
                  chars: rules.text.length,
                  preview: excerpt(rules.text, 400),
                },
                auditPath: auditPath,
              })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'method not allowed' })
              return
            }
            await readBody(req)
            if (method === 'reload') {
              rulesCache = { mtime: -1, text: rulesCache.text, source: rulesCache.source }
              const rules = loadRules()
              sendJson(res, 200, { ok: true, source: rules.source, path: rulesPath })
              return
            }
            if (method === 'clear') {
              decisions.length = 0
              sendJson(res, 200, { ok: true })
              return
            }
            sendJson(res, 404, { error: 'unknown method' })
          } catch (error) {
            sendJson(res, 500, { error: String((error && error.message) || error) })
          }
        },
      })
    } catch (error) {
      disposeRoute = undefined
    }
    return function () {
      if (typeof disposeRoute === 'function') disposeRoute()
    }
  })
}
