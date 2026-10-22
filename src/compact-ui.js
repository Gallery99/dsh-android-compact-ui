/**
 * compact-ui.js — turn uiautomator XML into a token-efficient screen description.
 *
 * Why: a raw uiautomator dump gives every node 14 attributes, 8 of which are
 * permanently "false" (checkable, focused, focusable, scrollable, long-clickable,
 * password, selected, checked). On a 98-node screen that is ~33,800 characters,
 * roughly 9,700 tokens — and an agent reads the screen before *every* action.
 *
 * This module keeps only what a model can act on and pre-computes the tap
 * centre, so the model never has to do coordinate arithmetic:
 *
 *     # 98 nodes -> 18 actionable
 *     904,816 | img | Assistant
 *     160,189 | btn | Settings | #settings
 *     -       | scroll
 *     # text
 *     Some static label
 *
 * Measured on a real MIUI screen: 33,819 chars (~9,660 tok) -> 483 chars (~138 tok).
 *
 * @module dsh-android-compact-ui
 */

'use strict'

/** Map a fully-qualified Android class name to a short, stable type token. */
const TYPE_MAP = {
  Button: 'btn',
  ImageButton: 'btn',
  TextView: 'txt',
  EditText: 'edit',
  AutoCompleteTextView: 'edit',
  CheckBox: 'chk',
  Switch: 'sw',
  RadioButton: 'radio',
  ImageView: 'img',
  View: 'view',
  ViewGroup: 'group',
  LinearLayout: 'group',
  FrameLayout: 'group',
  RelativeLayout: 'group',
  ConstraintLayout: 'group',
  ListView: 'list',
  RecyclerView: 'list',
  ScrollView: 'scroll',
  WebView: 'web',
  TabWidget: 'tabs',
  SeekBar: 'slider',
  ProgressBar: 'progress',
}

const NODE_RE = /<node\b([^>]*?)\/?>/g
const ATTR_RE = /([\w-]+)="([^"]*)"/g
const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/

/**
 * Shorten an Android class name to its type token.
 * @param {string} cls Fully-qualified class name, e.g. `android.widget.Button`.
 * @returns {string} Short token such as `btn`, or a lowercased leaf class name.
 */
function shortType(cls) {
  if (!cls) return '?'
  const leaf = cls.split('.').pop()
  return TYPE_MAP[leaf] || leaf.toLowerCase()
}

/**
 * Parse a uiautomator bounds string and return its integer centre.
 * @param {string} bounds Format `[x1,y1][x2,y2]`.
 * @returns {[number, number] | null} `[cx, cy]`, or null when absent or empty.
 */
function parseCentre(bounds) {
  const m = BOUNDS_RE.exec(bounds || '')
  if (!m) return null
  const x1 = Number(m[1])
  const y1 = Number(m[2])
  const x2 = Number(m[3])
  const y2 = Number(m[4])
  if (x2 <= x1 || y2 <= y1) return null
  return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]
}

/**
 * Parse one node's attribute string into a plain object.
 * @param {string} raw Everything between `<node` and the closing `>`.
 * @returns {Record<string, string>} Attribute name to raw value.
 */
function parseAttrs(raw) {
  const out = {}
  let m
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(raw))) out[m[1]] = m[2]
  return out
}

/**
 * Compress a uiautomator XML dump into a compact, model-facing description.
 *
 * Rules:
 *  - keep only interactive nodes (clickable or text-entry);
 *  - replace bounds with the pre-computed tap centre;
 *  - mark scrollable containers as `scroll` with no coordinates, so the model
 *    swipes instead of tapping;
 *  - fold `content-desc` into `text` when `text` is empty;
 *  - drop resource-id package prefixes;
 *  - de-duplicate the parent/child pairs uiautomator commonly reports twice;
 *  - list any remaining static text once, capped.
 *
 * @param {string} xml Raw XML emitted by `uiautomator dump`.
 * @param {object} [options]
 * @param {number} [options.maxText=25] Maximum trailing static-text lines.
 * @param {number} [options.maxLabel=40] Maximum characters per element label.
 * @returns {string} Newline-joined compact description.
 */
function compactUiXml(xml, options = {}) {
  const maxText = options.maxText ?? 25
  const maxLabel = options.maxLabel ?? 40

  const actionable = []
  const seenElements = new Set()
  const staticTexts = []
  const seenStatic = new Set()
  let nodeCount = 0

  let m
  NODE_RE.lastIndex = 0
  while ((m = NODE_RE.exec(xml || ''))) {
    nodeCount += 1
    const a = parseAttrs(m[1])

    const text = (a.text || '').trim()
    const desc = (a['content-desc'] || '').trim()
    const label = text || desc
    const cls = a.class || ''
    const clickable = a.clickable === 'true'
    const editable = /EditText|AutoCompleteTextView/.test(cls)
    const scrollable = a.scrollable === 'true'
    const checked = a.checked === 'true'
    const rid = (a['resource-id'] || '').replace(/^.*?:id\//, '')
    const centre = parseCentre(a.bounds)

    if (!label && !clickable && !editable && !scrollable) continue

    if (clickable || editable) {
      if (!centre) continue
      const type = editable ? 'edit' : shortType(cls)
      const key = `${centre[0]},${centre[1]}|${type}|${label}`
      if (seenElements.has(key)) continue
      seenElements.add(key)
      actionable.push({ centre, type, label, rid, checked })
    } else if (scrollable && centre) {
      const key = `scroll|${centre[0]},${centre[1]}`
      if (seenElements.has(key)) continue
      seenElements.add(key)
      actionable.push({ centre: null, type: 'scroll', label: '', rid, checked: false })
    } else if (label) {
      const key = `${label}|${centre ? centre.join(',') : ''}`
      if (seenStatic.has(key)) continue
      seenStatic.add(key)
      staticTexts.push(label)
    }
  }

  const covered = new Set(actionable.map((e) => e.label).filter(Boolean))

  const lines = [`# ${nodeCount} nodes -> ${actionable.length} actionable`]
  for (const e of actionable) {
    const cells = [e.centre ? `${e.centre[0]},${e.centre[1]}` : '-', e.type]
    if (e.label) cells.push(e.label.slice(0, maxLabel))
    if (e.rid) cells.push(`#${e.rid.slice(0, 30)}`)
    if (e.checked) cells.push('[ON]')
    lines.push(cells.join(' | '))
  }

  const extras = staticTexts.filter((t) => !covered.has(t))
  if (extras.length) {
    lines.push('# text')
    for (const t of extras.slice(0, maxText)) lines.push(t.slice(0, 60))
    if (extras.length > maxText) lines.push(`... +${extras.length - maxText}`)
  }

  return lines.join('\n')
}

/**
 * Report the token savings achieved for one dump.
 * @param {string} xml Raw uiautomator XML.
 * @param {string} compact Output of {@link compactUiXml}.
 * @param {number} [charsPerToken=3.5] Rough heuristic; CJK-heavy screens score lower.
 * @returns {{rawChars: number, compactChars: number, savedPercent: number, rawTokens: number, compactTokens: number}}
 */
function measure(xml, compact, charsPerToken = 3.5) {
  const rawChars = (xml || '').length
  const compactChars = (compact || '').length
  return {
    rawChars,
    compactChars,
    rawTokens: Math.round(rawChars / charsPerToken),
    compactTokens: Math.round(compactChars / charsPerToken),
    savedPercent: rawChars === 0 ? 0 : Number((100 * (1 - compactChars / rawChars)).toFixed(1)),
  }
}

module.exports = { compactUiXml, measure, parseCentre, shortType }
