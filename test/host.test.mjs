// Host-half tests. These drive the real apply() against a stub ctx, so the
// review gate's four outcomes — deny, allow, fail-open, and never-reviewed —
// are pinned without a running harness.

import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../src/host.js'

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'warden-test-'))
}

function stubLlm(reply) {
  const calls = []
  return {
    calls: calls,
    async *stream(options) {
      calls.push(options)
      if (typeof reply === 'function') {
        for (const chunk of reply(options)) yield chunk
        return
      }
      yield { type: 'text-delta', text: reply }
    },
  }
}

function setup(options) {
  const settings = options || {}
  const listeners = new Map()
  const routes = []
  const disposers = []

  const webServer = {
    register(route) {
      if (settings.registerThrows === true) throw new Error('webServer.register is unavailable')
      routes.push(route)
      if (settings.registerReturnsUndefined === true) return undefined
      return function () {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  const services = {
    webServer: webServer,
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'stub' }) },
  }
  if (settings.llm !== undefined) services.llm = settings.llm
  if (settings.goals !== undefined) services.goals = settings.goals

  const ctx = {
    // Cordis exposes injected services as ctx.<name>; only the soft reads go
    // through ctx.get(). The stub must model both.
    webServer: webServer,
    get(name) { return services[name] },
    on(event, listener) {
      listeners.set(event, listener)
      const dispose = function () {
        if (listeners.get(event) === listener) listeners.delete(event)
      }
      disposers.push(dispose)
      return dispose
    },
    effect(fn) {
      const dispose = fn()
      const wrapped = typeof dispose === 'function' ? dispose : function () {}
      disposers.push(wrapped)
      return wrapped
    },
  }

  const home = settings.home || makeHome()
  apply(ctx, { dshHome: home })

  return {
    home: home,
    routes: routes,
    listeners: listeners,
    // Unwinds exactly what Cordis unwinds when the plugin is unloaded.
    dispose() {
      const pending = disposers.splice(0)
      for (const dispose of pending) dispose()
    },
    async call(name, args, signal) {
      const listener = listeners.get('tools/pre-execute')
      assert.ok(listener, 'tools/pre-execute listener was registered')
      let nextCalls = 0
      const next = async function () { nextCalls = nextCalls + 1; return { kind: 'allow' } }
      const result = await listener({ name: name, arguments: args, callId: 'c1', agent: { id: 'agent-1' }, signal: signal }, next)
      return { result: result, nextCalls: nextCalls }
    },
  }
}

const shell = (command) => ({ command: command })

test('a destructive command the reviewer rejects is denied with its reason', async () => {
  const llm = stubLlm('{"allow":false,"reason":"这会删掉整个项目目录"}')
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf D:\\Projects\\important'))
  assert.equal(out.result.kind, 'deny')
  assert.match(out.result.reason, /这会删掉整个项目目录/)
  assert.equal(out.nextCalls, 0)
  assert.equal(llm.calls.length, 1)
})

test('a destructive command the reviewer approves runs untouched', async () => {
  const llm = stubLlm('{"allow":true}')
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/build-cache'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
  assert.equal(llm.calls.length, 1)
})

test('inert calls never reach the model', async () => {
  const llm = stubLlm('{"allow":false,"reason":"should never be asked"}')
  const h = setup({ llm: llm })
  const read = await h.call('read', { file_path: 'a.txt' })
  const glob = await h.call('glob', { pattern: '**/*.js' })
  assert.equal(read.nextCalls, 1)
  assert.equal(glob.nextCalls, 1)
  assert.equal(llm.calls.length, 0)
})

test('ordinary commands and writes are not sent to the model', async () => {
  const llm = stubLlm('{"allow":false,"reason":"should never be asked"}')
  const h = setup({ llm: llm })
  const status = await h.call('pwsh', shell('git status'))
  const write = await h.call('write', { file_path: 'src/a.js', content: 'x' })
  assert.equal(status.nextCalls, 1)
  assert.equal(write.nextCalls, 1)
  assert.equal(llm.calls.length, 0)
})

test('a sensitive-path write is reviewed', async () => {
  const llm = stubLlm('{"allow":false,"reason":"那是你的全局指令文件"}')
  const h = setup({ llm: llm })
  const out = await h.call('write', { file_path: 'C:\\Users\\me\\.dsh\\AGENTS.md', content: 'x' })
  assert.equal(out.result.kind, 'deny')
  assert.equal(llm.calls.length, 1)
})

test('model-side failure surfaces as a finish chunk and fails open', async () => {
  const llm = stubLlm(() => [{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500' } } }])
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('an aborted stream fails open', async () => {
  const llm = stubLlm(() => [{ type: 'finish', reason: { kind: 'aborted' } }])
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('unparseable reviewer output fails open', async () => {
  const llm = stubLlm('I think this is probably fine, but let me explain at length...')
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('a thrown stream fails open', async () => {
  const llm = {
    async *stream() { throw new Error('socket closed') },
  }
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('a missing llm service fails open', async () => {
  const h = setup({})
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('an already-aborted signal is skipped', async () => {
  const llm = stubLlm('{"allow":false,"reason":"nope"}')
  const h = setup({ llm: llm })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'), { aborted: true })
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
  assert.equal(llm.calls.length, 0)
})

test('arguments that cannot be serialised do not escape as an exception', async () => {
  const llm = stubLlm('{"allow":true}')
  const h = setup({ llm: llm })
  const circular = { self: null }
  circular.self = circular
  const out = await h.call('pwsh', circular)
  assert.equal(out.result.kind, 'allow')
  assert.equal(out.nextCalls, 1)
})

test('the goal objective is included when a goal is active', async () => {
  const llm = stubLlm('{"allow":true}')
  const goals = { get: () => ({ objective: '把调研报告写完', phase: 'running' }) }
  const h = setup({ llm: llm, goals: goals })
  await h.call('pwsh', shell('rm -rf /tmp/x'))
  const text = llm.calls[0].messages[0].content[0].text
  assert.match(text, /把调研报告写完/)
})

test('a goal lookup that throws is tolerated', async () => {
  const llm = stubLlm('{"allow":true}')
  const goals = { get: () => { throw new Error('not the live instance') } }
  const h = setup({ llm: llm, goals: goals })
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'allow')
})

test('rules load from the file when present, and reload when it changes', async () => {
  const home = makeHome()
  const rulesPath = join(home, 'adversary.md')
  const llm = stubLlm('{"allow":true}')
  const h = setup({ llm: llm, home: home })

  await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.match(llm.calls[0].system, /默认放行/)

  writeFileSync(rulesPath, '绝对禁止删除任何文件。', 'utf8')
  // mtime granularity can be coarse; the next stat must still see a change
  await h.call('pwsh', shell('rm -rf /tmp/y'))
  const systems = llm.calls.map((c) => c.system)
  assert.ok(systems.some((s) => /绝对禁止删除任何文件/.test(s)), 'file rules were picked up: ' + JSON.stringify(systems))
})

test('the state route reports stats and rendered decisions', async () => {
  const llm = stubLlm('{"allow":false,"reason":"太危险"}')
  const h = setup({ llm: llm })
  await h.call('pwsh', shell('git status'))
  await h.call('read', { file_path: 'a.txt' })
  await h.call('pwsh', shell('rm -rf /tmp/x'))

  const route = h.routes[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/dsh-warden')

  let payload
  const res = {
    setHeader() {},
    end(text) { payload = JSON.parse(text) },
  }
  await route.handler({ method: 'GET', url: '/dsh-warden/state' }, res)

  assert.equal(payload.stats.calls, 3)
  assert.equal(payload.stats.reviewed, 1)
  assert.equal(payload.stats.denied, 1)
  const denied = payload.decisions.find((d) => d.decision === 'deny')
  assert.ok(denied, 'the denial is reported')
  assert.equal(denied.reason, '太危险')
  assert.ok(payload.rules.path.endsWith('adversary.md'))
})

// ---- runtime unload -------------------------------------------------------
// dsh 0.1.6 resolves plugin dependencies at runtime and can unload a plugin
// mid-session. Unloading must actually undo everything this plugin registered,
// not merely stop it from doing more.

test('unloading removes both the route and the tool listener', () => {
  const h = setup({ llm: stubLlm('{"allow":true}') })
  assert.equal(h.routes.length, 1, 'route registered while loaded')
  assert.ok(h.listeners.get('tools/pre-execute'), 'listener registered while loaded')

  h.dispose()

  assert.equal(h.routes.length, 0, 'route removed on unload')
  assert.equal(h.listeners.get('tools/pre-execute'), undefined, 'listener removed on unload')
  assert.equal(h.listeners.size, 0, 'no listener left behind')
})

test('a webServer that refuses to register does not take the gate down with it', async () => {
  const llm = stubLlm('{"allow":false,"reason":"太危险"}')
  const h = setup({ llm: llm, registerThrows: true })
  assert.equal(h.routes.length, 0, 'no route was registered')
  const out = await h.call('pwsh', shell('rm -rf /tmp/x'))
  assert.equal(out.result.kind, 'deny', 'the gate still reviews')
})

test('a register() that returns no disposer is tolerated on unload', () => {
  const h = setup({ registerReturnsUndefined: true })
  assert.equal(h.routes.length, 1)
  h.dispose()
  assert.equal(h.listeners.size, 0)
})

test('a review that settles after unload neither throws nor re-registers', async () => {
  let release
  const gate = new Promise(function (resolve) { release = resolve })
  const llm = {
    async *stream() {
      await gate
      yield { type: 'text-delta', text: '{"allow":false,"reason":"迟到的判定"}' }
    },
  }
  const h = setup({ llm: llm })
  const pending = h.call('pwsh', shell('rm -rf /tmp/x'))
  h.dispose()
  release()
  const out = await pending
  assert.equal(out.result.kind, 'deny')
  assert.equal(h.routes.length, 0)
  assert.equal(h.listeners.size, 0)
})
