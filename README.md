# dsh-android-compact-ui

> Cut DeepSeek Harness phone-driving token costs by **~98%**.

`dsh-android-compact-ui` turns `uiautomator` XML dumps into a compact,
**tap-ready** element list. Built for agents that drive a real Android phone
(DSH's `dsh-android-control`, or any ADB-based loop).

## The problem

A raw `uiautomator dump` gives every node **14 attributes, 8 of which are
permanently `false`**:

```
<node index="0" text="" resource-id="" class="android.widget.FrameLayout"
      package="com.miui.home" content-desc="" checkable="false" checked="false"
      clickable="false" enabled="true" focusable="false" focused="false"
      scrollable="false" long-clickable="false" password="false" selected="false"
      bounds="[0,0][1920,1079]">
```

Measured on a real screen with 98 nodes:

| | raw XML | compact |
|---|---|---|
| characters | 33,819 | **483** |
| tokens (approx) | **9,660** | **138** |

An agent reads the screen before *every* action. A 10-step task burns
**~100k tokens** on screen descriptions alone. After this: **~1,400**.

## Output format

```
# 98 nodes -> 18 actionable
-       | scroll |                | #workspace
904,816 | img    | Assistant
160,189 | btn    | Termux
414,451 | edit   | Search         | #search_box
668,713 | group  | Settings       | [ON]
# text
Some static label that is not tappable
```

Each actionable line is `tapX,tapY | type | label | #resourceId`.

**Coordinates are already the element centre** — pass them straight to your tap
tool. The model never does coordinate arithmetic.

## Install

```bash
npm install -g dsh-android-compact-ui
```

Or use it directly:

```bash
# compress a saved dump
npx dsh-android-compact-ui ui.xml

# pull one off a connected device and compress it
npx dsh-android-compact-ui --device

# pipe
adb shell 'uiautomator dump /sdcard/ui.xml' && adb pull /sdcard/ui.xml - | npx dsh-android-compact-ui

# machine-readable summary
npx dsh-android-compact-ui ui.xml --json
```

## As a library

```js
const { compactUiXml, measure } = require('dsh-android-compact-ui')

const compact = compactUiXml(xml)
const stats = measure(xml, compact)
// => { rawChars, compactChars, rawTokens, compactTokens, savedPercent }
```

Options:

```js
compactUiXml(xml, {
  maxText: 25,    // cap on trailing static-text lines
  maxLabel: 40,   // cap on characters per element label
})
```

## Patch an existing DSH plugin

Already using [`dsh-android-control`](https://github.com/railgun0325/dsh-phone)?
Patch its `android_ui_dump` tool in place:

```bash
node bin/patch.js /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/dsh-android-control
```

- the dump tool now returns the compact list by default;
- `raw=true` returns the original XML, so nothing is lost;
- the tool description is rewritten to tell the model the coordinates are
  already centred;
- re-running is a no-op, and it refuses to patch if the plugin's structure
  changed underneath it.

Restart `dsh web` afterwards to pick up the new code.

## What it drops, and why it is safe

| Dropped | Why |
|---|---|
| `checkable/focusable/focused/scrollable/long-clickable/password/selected` | permanently `false` on virtually every node |
| `enabled="true"` | the overwhelming majority; a disabled control is still worth showing |
| `index`, `package`, `resource-id` prefix | no routing value for the model |
| layout containers with no text and no actions | pure nesting noise |
| duplicate parent/child rows | uiautomator frequently reports the same label twice |

Kept: label (text or content-desc), element type, tap centre, resource-id leaf,
checked state, and scrollable containers (marked `scroll` with no coordinates,
so the model swipes instead of tapping).

## Prior art

- [actionstatelabs/android-action-kernel `sanitizer.py`](https://raw.githubusercontent.com/actionstatelabs/android-action-kernel/main/sanitizer.py)
  — same filtering idea, but keeps 8 fields per element and omits the tap centre.
- [dsh-android-agent](https://dshbase.com/plugins/dsh-android-agent/) — queries
  the tree device-side (`phone_ui_find`) which is even cheaper per query, but
  needs its own on-device agent.
- [A11y-Compressor](https://aclanthology.org/2026.acl-srw.50/) — academic
  approach using visual context reconstruction and redundancy reduction.

## Going further

Still on the table for even lower cost:

- **Device-side lookup** — a `ui_find(text)` tool that greps the XML on the phone
  and returns one match (~30 tokens per query).
- **Incremental diff** — send only the elements that changed since the last step.

## License

MIT
