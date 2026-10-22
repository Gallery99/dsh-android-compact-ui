#!/usr/bin/env node
'use strict'

/**
 * patch.js — rewrite `dsh-android-control`'s `android_ui_dump` so it returns the
 * compact screen description instead of the raw uiautomator XML.
 *
 * The plugin's dump tool is the single biggest token sink in a phone-driving
 * agent loop: it returns ~9,700 tokens of attributes per screen, of which 8 of
 * every node's 14 attributes are permanently "false". After patching, the same
 * tool returns ~138 tokens with tap coordinates already computed.
 *
 * The patched build keeps an escape hatch: calling the tool with `raw=true`
 * returns the original XML, so nothing is lost.
 *
 * Usage:
 *   node patch.js <path-to-dsh-android-control>
 *   node patch.js --dry-run <path-to-dsh-android-control>
 */

const fs = require('node:fs')
const path = require('node:path')

const MARK = '/*__COMPACT_UI__*/'

const COMPACTOR = `
${MARK}
/**
 * Compress a uiautomator XML dump into a list of actionable elements.
 * Inlined so the patched plugin stays dependency-free.
 */
function compactUiXml(xml) {
  const NODE_RE = /<node\\b([^>]*?)\\/?>/g
  const ATTR_RE = /([\\w-]+)="([^"]*)"/g
  const TYPE_MAP = {
    Button: 'btn', ImageButton: 'btn', TextView: 'txt', EditText: 'edit',
    AutoCompleteTextView: 'edit', CheckBox: 'chk', Switch: 'sw',
    RadioButton: 'radio', ImageView: 'img', View: 'view',
    ViewGroup: 'group', LinearLayout: 'group', FrameLayout: 'group',
    RelativeLayout: 'group', ConstraintLayout: 'group', ListView: 'list',
    RecyclerView: 'list', ScrollView: 'scroll', WebView: 'web',
    TabWidget: 'tabs', SeekBar: 'slider',
  }
  const shortType = (cls) => cls ? (TYPE_MAP[cls.split('.').pop()] || cls.split('.').pop().toLowerCase()) : '?'
  const centre = (b) => {
    const m = /\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]/.exec(b || '')
    if (!m) return null
    const x1 = +m[1], y1 = +m[2], x2 = +m[3], y2 = +m[4]
    if (x2 <= x1 || y2 <= y1) return null
    return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)]
  }

  const actionable = []
  const seen = new Set()
  const texts = []
  const seenText = new Set()
  let nodes = 0

  let m
  while ((m = NODE_RE.exec(xml))) {
    nodes++
    const attrs = {}
    let a
    ATTR_RE.lastIndex = 0
    while ((a = ATTR_RE.exec(m[1]))) attrs[a[1]] = a[2]

    const label = ((attrs.text || '').trim() || (attrs['content-desc'] || '').trim())
    const cls = attrs.class || ''
    const clickable = attrs.clickable === 'true'
    const editable = /EditText|AutoCompleteTextView/.test(cls)
    const scrollable = attrs.scrollable === 'true'
    const c = centre(attrs.bounds)

    if (!label && !clickable && !editable && !scrollable) continue

    if (clickable || editable) {
      if (!c) continue
      const type = editable ? 'edit' : shortType(cls)
      const key = c[0] + ',' + c[1] + '|' + type + '|' + label
      if (seen.has(key)) continue
      seen.add(key)
      actionable.push({
        xy: c, type, label,
        rid: (attrs['resource-id'] || '').replace(/^.*?:id\\//, ''),
        checked: attrs.checked === 'true',
      })
    } else if (scrollable && c) {
      actionable.push({ xy: null, type: 'scroll', label: '', rid: '', checked: false })
    } else if (label) {
      const key = label + '|' + (c ? c.join(',') : '')
      if (!seenText.has(key)) { seenText.add(key); texts.push(label) }
    }
  }

  const covered = new Set(actionable.map((e) => e.label).filter(Boolean))
  const extras = texts.filter((t) => !covered.has(t))

  const lines = ['# ' + nodes + ' nodes -> ' + actionable.length + ' actionable']
  for (const e of actionable) {
    const cells = [e.xy ? e.xy[0] + ',' + e.xy[1] : '-', e.type]
    if (e.label) cells.push(e.label.slice(0, 40))
    if (e.rid) cells.push('#' + e.rid.slice(0, 30))
    if (e.checked) cells.push('[ON]')
    lines.push(cells.join(' | '))
  }
  if (extras.length) {
    lines.push('# text')
    for (const t of extras.slice(0, 25)) lines.push(t.slice(0, 60))
    if (extras.length > 25) lines.push('... +' + (extras.length - 25))
  }
  return lines.join('\\n')
}
`

const OLD_EXEC = `    async execute(args, exec) {
      const path = '/data/local/tmp/ui-dump-' + Date.now() + '.xml'
      const res = await run('uiautomator dump ' + shq(path) + ' >/dev/null 2>&1 && cat ' + shq(path) + ' && rm -f ' + shq(path), { timeout: 80000, signal: exec.signal })
      const xml = res.stdout
      const max = typeof args.maxChars === 'number' ? args.maxChars : 12000
      return res.ok
        ? { ok: true, length: xml.length, truncated: xml.length > max, xml: xml.slice(0, max) }
        : { ok: false, error: res.stderr.trim() || 'uiautomator dump failed' }
    },`

const NEW_EXEC = `    async execute(args, exec) {
      const path = '/data/local/tmp/ui-dump-' + Date.now() + '.xml'
      const res = await run('uiautomator dump ' + shq(path) + ' >/dev/null 2>&1 && cat ' + shq(path) + ' && rm -f ' + shq(path), { timeout: 80000, signal: exec.signal })
      const xml = res.stdout
      if (!res.ok) return { ok: false, error: res.stderr.trim() || 'uiautomator dump failed' }
      // Default path returns the compact actionable-element list (~138 tokens
      // per screen instead of ~9,700). Pass raw=true for the original XML.
      if (args.raw === true) {
        const max = typeof args.maxChars === 'number' ? args.maxChars : 12000
        return { ok: true, length: xml.length, truncated: xml.length > max, xml: xml.slice(0, max) }
      }
      return { ok: true, length: xml.length, compact: compactUiXml(xml) }
    },`

const OLD_DESC = `      'Dump the current screen hierarchy via uiautomator as XML (truncated to maxChars, default 12000). '
      + 'Use it to find element bounds, text and resource-ids before tapping or typing.',`

const NEW_DESC = `      'Read the current screen as a compact list of actionable elements. '
      + 'Each line is: tapCenterX,tapCenterY | type | label | resourceId. Coordinates are already '
      + 'the element centre, so pass them straight to android_tap. Much cheaper than raw XML. '
      + 'Set raw=true only when you need the full uiautomator XML.',`

const OLD_PARAMS = `      maxChars: { type: 'integer', description: 'Truncate XML to this many characters (default 12000).' },`

const NEW_PARAMS = `      raw: { type: 'boolean', description: 'Return the raw uiautomator XML instead of the compact list (costly).' },
      maxChars: { type: 'integer', description: 'Only with raw=true: truncate XML to this many characters (default 12000).' },`

/**
 * Apply the patch to a plugin directory.
 * @param {string} dir Path to `dsh-android-control`.
 * @param {{dryRun?: boolean}} [opts]
 * @returns {{changed: boolean, reason?: string, target: string}}
 */
function patch(dir, opts = {}) {
  const target = path.join(dir, 'index.js')
  if (!fs.existsSync(target)) {
    return { changed: false, reason: `not found: ${target}`, target }
  }

  let src = fs.readFileSync(target, 'utf8')
  if (src.includes(MARK)) return { changed: false, reason: 'already patched', target }

  const anchor = /(const renderJson = [^\n]*\n)/
  if (!anchor.test(src)) return { changed: false, reason: 'anchor `renderJson` not found', target }
  src = src.replace(anchor, `$1${COMPACTOR}\n`)

  if (!src.includes(OLD_EXEC)) {
    return { changed: false, reason: 'android_ui_dump execute block not found (plugin version changed?)', target }
  }
  src = src.replace(OLD_EXEC, NEW_EXEC)

  // Description and params are cosmetic; warn rather than fail if their text moved.
  if (src.includes(OLD_DESC)) src = src.replace(OLD_DESC, NEW_DESC)
  else process.emitWarning('tool description anchor not found — patched behaviourally only')
  if (src.includes(OLD_PARAMS)) src = src.replace(OLD_PARAMS, NEW_PARAMS)
  else process.emitWarning('tool params anchor not found — patched behaviourally only')

  if (opts.dryRun) return { changed: true, reason: 'dry run', target }
  fs.writeFileSync(target, src)
  return { changed: true, target }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dir = args.find((a) => !a.startsWith('-'))
  if (!dir) {
    process.stderr.write('usage: node patch.js [--dry-run] <path-to-dsh-android-control>\n')
    process.exit(2)
  }
  const r = patch(dir, { dryRun })
  if (!r.changed) {
    process.stderr.write(`not patched: ${r.reason}\n`)
    process.exit(r.reason === 'already patched' ? 0 : 1)
  }
  process.stdout.write(`${dryRun ? 'would patch' : 'patched'}: ${r.target}\n`)
}

module.exports = { patch, MARK }
