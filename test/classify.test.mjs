import { strict as assert } from 'node:assert'
import test from 'node:test'
import { classify, describeClass, shouldReview } from '../src/classify.js'

test('inert tools are invisible to the gate', () => {
  assert.equal(classify('read', '{"file_path":"a.txt"}'), undefined)
  assert.equal(classify('grep', '{"pattern":"rm -rf"}'), 'other-destructive')
  assert.equal(classify('glob', '{"pattern":"**/*.js"}'), undefined)
  assert.equal(classify('web_search', '{"queries":["x"]}'), undefined)
})

test('ordinary commands and writes are classified but not reviewed', () => {
  assert.equal(classify('pwsh', '{"command":"git status"}'), 'execute')
  assert.equal(classify('pwsh', '{"command":"npm test"}'), 'execute')
  assert.equal(classify('write', '{"file_path":"src/a.js","content":"x"}'), 'edit')
  assert.equal(shouldReview('execute'), false)
  assert.equal(shouldReview('edit'), false)
})

test('destructive shell commands are reviewed', () => {
  const cases = [
    'rm -rf /tmp/x',
    'rm -fr /tmp/x',
    'rm -f -r /var',
    'rm -r -f /var',
    'sudo rm -f -r /var',
    'rm --recursive --force /var',
    'Remove-Item -Recurse -Force D:\\x',
    'rm -Recurse -Force D:\\x',
    'rmdir /s /q C:\\x',
    'format c:',
    'mkfs.ext4 /dev/sda1',
    'git push origin main --force',
    'git reset --hard HEAD~3',
    'git clean -fd',
    'dd if=/dev/zero of=/dev/sda',
    'DROP TABLE users',
    'drop database prod',
    'shutdown /s /t 0',
  ]
  for (const command of cases) {
    const raw = JSON.stringify({ command: command })
    assert.equal(classify('pwsh', raw), 'execute-destructive', command)
    assert.equal(shouldReview('execute-destructive'), true)
  }
})

test('a plain single-file rm is not treated as destructive', () => {
  assert.equal(classify('pwsh', JSON.stringify({ command: 'rm notes.txt' })), 'execute')
  assert.equal(classify('pwsh', JSON.stringify({ command: 'rm -i notes.txt' })), 'execute')
})

test('benign commands that merely mention destructive words stay reviewed', () => {
  // The gate is intentionally coarse here: a false review costs one cheap model
  // call, a missed destruction costs the user their data.
  const raw = JSON.stringify({ command: "Write-Output 'rm -rf /demo'" })
  assert.equal(classify('pwsh', raw), 'execute-destructive')
})

test('writes to credential and config paths are reviewed', () => {
  const paths = [
    'C:\\Users\\me\\.dsh\\AGENTS.md',
    '/home/me/.env',
    '/repo/.git/config',
    'D:\\p\\cordis.patch.yml',
    'C:\\Users\\me\\.ssh\\id_rsa',
    'C:\\Users\\me\\.dsh\\profiles\\web\\package.json',
  ]
  for (const path of paths) {
    const raw = JSON.stringify({ file_path: path, content: 'x' })
    assert.equal(classify('write', raw), 'edit-sensitive', path)
    assert.equal(shouldReview('edit-sensitive'), true)
  }
})

test('ordinary project files are not reviewed', () => {
  for (const path of ['src/host.js', 'D:\\Projects\\app\\README.md', 'test/a.test.mjs', 'package.json']) {
    assert.equal(classify('write', JSON.stringify({ file_path: path })), 'edit', path)
  }
})

test('unknown tools carrying a destructive payload are still caught', () => {
  assert.equal(classify('some_custom_tool', '{"script":"rm -rf /"}'), 'other-destructive')
  assert.equal(classify('some_custom_tool', '{"script":"echo hi"}'), undefined)
})

test('missing or malformed arguments never throw', () => {
  assert.equal(classify(undefined, undefined), undefined)
  assert.equal(classify(null, null), undefined)
  assert.equal(classify('pwsh', undefined), 'execute')
  assert.equal(classify('write', 123), 'edit')
})

test('every class has a label', () => {
  for (const cls of ['execute-destructive', 'edit-sensitive', 'other-destructive', 'execute', 'edit']) {
    assert.equal(typeof describeClass(cls), 'string')
    assert.notEqual(describeClass(cls).length, 0)
  }
  assert.equal(describeClass(undefined), '未分类')
})
