// Pure classification logic: no I/O, no service access, fully unit-testable.
//
// The gate is deliberately two-layered. Layer 1 (this file) decides whether a
// tool call is worth spending a model call on. Layer 2 (host.js) sends only the
// survivors to the reviewer model. Without layer 1 every file read would cost a
// round trip; with it, ordinary work pays nothing.

// Commands that destroy data or rewrite history irreversibly. Matched against
// the raw JSON of the tool arguments, so it also catches a destructive-looking
// payload nested inside an otherwise ordinary call.
// `rm` is matched with two lookaheads rather than a flag-shaped pattern: the
// recursive and force flags may be written together (-rf), reversed (-fr), or
// as separate flags in either order (-f -r), and only requiring both of them
// avoids flagging an ordinary single-file `rm`.
export const DESTRUCTIVE = /rm\b(?=[^\n]*(?:-[a-z]*r[a-z]*\b|--recursive\b))(?=[^\n]*(?:-[a-z]*f[a-z]*\b|--force\b))|Remove-Item[^\n]*-Recurse|rmdir\s+\/s|del\s+\/[sq]|format\s+[a-z]:|mkfs|dd\s+if=|drop\s+(table|database)|truncate\s+table|git\s+push[^\n]*(--force|\s-f\b)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|shutdown|Stop-Computer|Clear-Disk|Initialize-Disk|chmod\s+-R\s+777\s+\/|takeown|>\s*\/dev\/sd/i

// Paths whose contents are credentials, harness configuration, or the agent's
// own instructions. Writing these is how an agent escalates itself, so a write
// here is reviewed even though it looks like an ordinary edit.
// `cordis[\w.-]*ya?ml` deliberately spans the middle segment so that both
// cordis.yml and the bundled cordis.patch.yml are caught.
export const SENSITIVE = /[.\\/](env|npmrc|netrc)|\.env\b|credential|secret|id_rsa|\.ssh|[.\\/]\.git[\\/]|settings\.(json|ya?ml)|cordis[\w.-]*ya?ml|AGENTS\.md|[.\\/]\.dsh[\\/]|token/i

export const SHELL_TOOLS = new Set(['pwsh', 'bash', 'shell', 'powershell', 'cmd', 'exec'])
export const WRITE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor', 'notebook_edit'])

/**
 * Classify one pending tool call.
 *
 * Returns a class string, or undefined when the call is clearly inert and needs
 * no further thought at all:
 *   'execute-destructive' / 'edit-sensitive' / 'other-destructive' -> review
 *   'execute' / 'edit'                                             -> pass, but counted
 *   undefined                                                      -> invisible to the gate
 */
export function classify(toolName, rawArgs) {
  const name = typeof toolName === 'string' ? toolName : ''
  const raw = typeof rawArgs === 'string' ? rawArgs : ''
  if (SHELL_TOOLS.has(name)) {
    return DESTRUCTIVE.test(raw) ? 'execute-destructive' : 'execute'
  }
  if (WRITE_TOOLS.has(name)) {
    return SENSITIVE.test(raw) ? 'edit-sensitive' : 'edit'
  }
  if (DESTRUCTIVE.test(raw)) return 'other-destructive'
  return undefined
}

/** Only the three risky classes reach the reviewer model. */
export function shouldReview(cls) {
  return cls === 'execute-destructive' || cls === 'edit-sensitive' || cls === 'other-destructive'
}

/** Stable label for the UI badge. */
export function describeClass(cls) {
  if (cls === 'execute-destructive') return '破坏性命令'
  if (cls === 'edit-sensitive') return '敏感路径写入'
  if (cls === 'other-destructive') return '破坏性载荷'
  if (cls === 'execute') return '普通命令'
  if (cls === 'edit') return '普通写入'
  return '未分类'
}
