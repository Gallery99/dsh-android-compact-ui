#!/usr/bin/env node
'use strict'

/**
 * CLI: compress a saved uiautomator dump, or pull one straight off a device.
 *
 *   cat ui.xml | npx dsh-android-compact-ui
 *   npx dsh-android-compact-ui ui.xml
 *   npx dsh-android-compact-ui --device            # adb shell uiautomator dump
 *   npx dsh-android-compact-ui ui.xml --max-text 10
 *   npx dsh-android-compact-ui ui.xml --json       # machine-readable summary
 */

const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { compactUiXml, measure } = require('../src/compact-ui.js')

function parseArgs(argv) {
  const opts = { file: null, maxText: 25, json: false, device: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--device') opts.device = true
    else if (a === '--json') opts.json = true
    else if (a === '--max-text') opts.maxText = Number(argv[++i])
    else if (a === '--help' || a === '-h') opts.help = true
    else if (!a.startsWith('-')) opts.file = a
  }
  return opts
}

function usage() {
  process.stdout.write(`Usage:
  dsh-android-compact-ui [file]        read XML from file or stdin
  dsh-android-compact-ui --device      run \`adb shell uiautomator dump\` first
Options:
  --max-text <n>   cap trailing static-text lines (default 25)
  --json           print a JSON summary instead of the compact text
  -h, --help       show this help
`)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { usage(); return }

  let xml
  if (opts.device) {
    const tmp = `/data/local/tmp/compact-ui-${Date.now()}.xml`
    execFileSync('adb', ['shell', `uiautomator dump ${tmp} >/dev/null 2>&1 && cat ${tmp} && rm -f ${tmp}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    xml = execFileSync('adb', ['shell', 'cat', tmp], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } else if (opts.file) {
    xml = fs.readFileSync(opts.file, 'utf8')
  } else {
    xml = fs.readFileSync(0, 'utf8')
  }

  const compact = compactUiXml(xml, { maxText: opts.maxText })
  const stats = measure(xml, compact)

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ...stats, compact }, null, 2) + '\n')
    return
  }

  process.stdout.write(compact + '\n')
  process.stderr.write(
    `\n[raw ${stats.rawChars} chars ~${stats.rawTokens} tok] -> ` +
    `[compact ${stats.compactChars} chars ~${stats.compactTokens} tok], ` +
    `saved ${stats.savedPercent}%\n`,
  )
}

main()
