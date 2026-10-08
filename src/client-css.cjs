// Client styles for dsh-warden.
//
// Colours are built with color-mix() against currentColor and low-alpha
// accents, so the panel inherits the host theme instead of fighting it. There
// is no hard-coded background or text colour anywhere, which is what keeps it
// legible under both light and dark themes without shipping two palettes.

module.exports = [
  '.wd-root{display:flex;flex-direction:column;gap:14px;padding:16px;height:100%;overflow:auto;color:inherit;font-size:13px;line-height:1.5}',
  '.wd-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
  '.wd-title{font-size:15px;font-weight:600}',
  '.wd-sub{opacity:.6;font-size:12px}',
  '.wd-spacer{flex:1}',
  '.wd-btn{border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:transparent;color:inherit;font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;cursor:pointer}',
  '.wd-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent)}',
  '.wd-btn:disabled{opacity:.45;cursor:default}',
  '.wd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px}',
  '.wd-stat{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;padding:8px 10px}',
  '.wd-stat b{display:block;font-size:18px;font-variant-numeric:tabular-nums;line-height:1.2}',
  '.wd-stat span{opacity:.6;font-size:11px}',
  '.wd-stat.wd-bad b{color:#dc2626}',
  '.wd-stat.wd-good b{color:#16a34a}',
  '.wd-card{border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:8px;padding:10px 12px}',
  '.wd-card h4{margin:0 0 6px;font-size:12px;font-weight:600;opacity:.75}',
  '.wd-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}',
  '.wd-preview{white-space:pre-wrap;opacity:.75;font-size:12px;margin-top:6px;max-height:132px;overflow:auto}',
  '.wd-list{display:flex;flex-direction:column;gap:6px}',
  '.wd-row{display:grid;grid-template-columns:62px 1fr auto;gap:10px;align-items:start;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:8px;padding:7px 10px}',
  '.wd-row.wd-deny{border-color:color-mix(in srgb,#dc2626 55%,transparent);background:color-mix(in srgb,#dc2626 8%,transparent)}',
  '.wd-row.wd-err{border-color:color-mix(in srgb,#d97706 55%,transparent);background:color-mix(in srgb,#d97706 8%,transparent)}',
  '.wd-time{opacity:.55;font-size:11px;font-variant-numeric:tabular-nums;padding-top:1px}',
  '.wd-tool{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
  '.wd-meta{opacity:.6;font-size:11px;margin-top:2px}',
  '.wd-reason{margin-top:5px;font-size:12px}',
  '.wd-badge{font-size:11px;padding:1px 8px;border-radius:999px;white-space:nowrap;border:1px solid transparent}',
  '.wd-badge.wd-allow{background:color-mix(in srgb,#16a34a 18%,transparent);color:color-mix(in srgb,#16a34a 80%,currentColor);border-color:color-mix(in srgb,#16a34a 35%,transparent)}',
  '.wd-badge.wd-deny{background:color-mix(in srgb,#dc2626 18%,transparent);color:color-mix(in srgb,#dc2626 80%,currentColor);border-color:color-mix(in srgb,#dc2626 35%,transparent)}',
  '.wd-badge.wd-pass{background:color-mix(in srgb,currentColor 8%,transparent);opacity:.7}',
  '.wd-badge.wd-err{background:color-mix(in srgb,#d97706 18%,transparent);color:color-mix(in srgb,#d97706 80%,currentColor);border-color:color-mix(in srgb,#d97706 35%,transparent)}',
  '.wd-empty{opacity:.55;font-size:12px;padding:10px 0}',
  '.wd-err{border:1px solid color-mix(in srgb,#dc2626 50%,transparent);background:color-mix(in srgb,#dc2626 8%,transparent);border-radius:8px;padding:8px 10px;font-size:12px}',
].join('')
