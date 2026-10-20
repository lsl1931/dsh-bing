// One injected stylesheet; all colours and borders use DSH design tokens so
// the picker follows the active light/dark theme.
const STYLE_ID = 'dsh-bing-style'

const CSS = [
  '.dsh_bing_section{max-width:760px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}',
  '.dsh_bing_detail{margin-top:20px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}',
  '.dsh_bing_h2{margin:0;font-size:18px;font-weight:600}',
  '.dsh_bing_subtitle{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}',
  '.dsh_bing_card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
  '.dsh_bing_cardTitle{margin:0;font-size:14px;font-weight:600}',
  '.dsh_bing_row{display:flex;align-items:flex-start;gap:10px}',
  '.dsh_bing_rowText{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.dsh_bing_rowLabel{font-size:13px;line-height:18px;cursor:pointer}',
  '.dsh_bing_rowDesc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_check{margin-top:2px;accent-color:var(--dsw-alias-state-business-primary)}',
  '.dsh_bing_soundRow{display:flex;align-items:center;gap:10px;justify-content:space-between}',
  '.dsh_bing_soundLabel{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_picker{position:relative;flex:0 0 auto}',
  '.dsh_bing_trigger{display:inline-flex;align-items:center;gap:6px;max-width:240px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh_bing_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_triggerLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_caret{color:var(--dsw-alias-label-tertiary);font-size:10px}',
  '.dsh_bing_panel{position:absolute;z-index:40;top:calc(100% + 6px);right:0;width:320px;max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-surface-secondary,var(--dsw-alias-bg-layer-2,#1c1d21));box-shadow:0 10px 30px rgba(0,0,0,.28);padding:6px}',
  '.dsh_bing_group{padding:4px 0}',
  '.dsh_bing_groupLabel{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:4px 6px;text-transform:uppercase;letter-spacing:.04em}',
  '.dsh_bing_option{display:flex;align-items:center;gap:4px;border-radius:7px;padding:2px 2px 2px 0}',
  '.dsh_bing_option:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_selected{background:var(--dsw-alias-interactive-bg-selected,var(--dsw-alias-interactive-bg-hover))}',
  '.dsh_bing_optionMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:5px 7px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.dsh_bing_optionName{font-size:12px;line-height:17px}',
  '.dsh_bing_optionMeta{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh_bing_preview{flex:0 0 auto;width:26px;height:24px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;cursor:pointer}',
  '.dsh_bing_preview:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px}',
  '.dsh_bing_button{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh_bing_button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dsh_bing_danger{color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_danger:hover{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary))}',
  '.dsh_bing_list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}',
  '.dsh_bing_listRow{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:18px}',
  '.dsh_bing_muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
  '.dsh_bing_input{width:64px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
  '.dsh_bing_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.dsh_bing_note{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
].join('')

function adoptStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin="dsh-bing"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-bing'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

module.exports = { adoptStyles, STYLE_ID, CSS }