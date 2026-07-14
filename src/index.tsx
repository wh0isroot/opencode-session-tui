import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import type { RGBA } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_ID = "opencode-session-tui"

/** How many root sessions to display in the sidebar. */
const MAX_SESSIONS = 10

/** Persisted key for "task completed, not yet viewed" session ids. */
const UNREAD_KV_KEY = "sidebar-sessions.unread.v1"

/** Sidebar slot order — smaller = higher up in the sidebar. */
const SLOT_ORDER = 50

/** Max display columns shown for a session title before ellipsis (wide/CJK chars count as 2). */
const TITLE_MAX = 26

// ---------------------------------------------------------------------------
// State classification
// ---------------------------------------------------------------------------

type StateKind =
  /** Session run is in progress. */
  | "busy"
  /** Session is retrying after a transient failure. */
  | "retry"
  /** Awaiting user answer to a question. */
  | "question"
  /** Awaiting user permission decision. */
  | "permission"
  /** Task finished while the user was viewing a different session. */
  | "unread"
  /** Nothing notable. */
  | "idle"

type Marker = {
  icon: string
  fg: RGBA
  /** True when the row itself should draw the user's eye (bold, primary color). */
  attention: boolean
}

function classify(
  api: TuiPluginApi,
  sessionID: string,
  status: SessionStatus | undefined,
  unread: ReadonlySet<string>,
): StateKind {
  // Awaiting-user states OUTRANK busy/idle because they block progress and need action.
  if (api.state.session.question(sessionID).length > 0) return "question"
  if (api.state.session.permission(sessionID).length > 0) return "permission"
  if (status?.type === "busy") return "busy"
  if (status?.type === "retry") return "retry"
  if (unread.has(sessionID)) return "unread"
  return "idle"
}

function markerFor(kind: StateKind, theme: TuiPluginApi["theme"]["current"]): Marker {
  const t = theme
  switch (kind) {
    case "busy":
      return { icon: "⏵", fg: t.accent, attention: false }
    case "retry":
      return { icon: "↻", fg: t.warning, attention: false }
    case "question":
      return { icon: "?", fg: t.warning, attention: true }
    case "permission":
      return { icon: "!", fg: t.warning, attention: true }
    case "unread":
      return { icon: "•", fg: t.success, attention: true }
    case "idle":
      return { icon: " ", fg: t.textMuted, attention: false }
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/** East Asian Wide / Fullwidth (and common emoji) code points render as 2 terminal columns. */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals … CJK Symbols & Punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK Compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1f64f) || // emoji (Misc Symbols & Pictographs, Emoticons, Transport)
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // Supplemental Symbols & Pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Extension B+
  )
}

/** Display width of a string in terminal columns (iterates by code point so surrogate pairs count once). */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1
  return w
}

/**
 * Truncate to a display-column budget, appending "…" (1 column) when clipped.
 *
 * The terminal renders by columns, not UTF-16 code units: CJK / fullwidth chars
 * occupy 2 columns each. Measuring with `.length` let wide-char titles pass a
 * character-count check yet overflow the fixed-width sidebar, where the host
 * hard-clips them at an inconsistent column (no ellipsis) — a ragged right edge.
 * Counting columns keeps every row inside the budget.
 */
export function truncate(raw: string, maxCols: number): string {
  const s = raw || "(untitled)"
  if (displayWidth(s) <= maxCols) return s
  let out = ""
  let w = 0
  for (const ch of s) {
    const cw = isWideCodePoint(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > maxCols - 1) break // reserve 1 column for the ellipsis
    out += ch
    w += cw
  }
  return out + "…"
}

function SessionsView(props: { api: TuiPluginApi }) {
  const api = props.api
  const theme = () => api.theme.current

  // --- Unread tracking (persisted) ------------------------------------------
  //
  // "Unread" = a session transitioned busy/retry → idle while the user was
  // viewing a DIFFERENT session. Cleared when they navigate into that session.
  //
  // Persisted via api.kv so the highlight survives TUI restarts.

  const initialUnread = new Set<string>(api.kv.get<string[]>(UNREAD_KV_KEY, []) ?? [])
  const [unread, setUnread] = createSignal<Set<string>>(initialUnread)
  const persistUnread = (next: Set<string>) => {
    setUnread(next)
    api.kv.set(UNREAD_KV_KEY, [...next])
  }

  /** Session ids we've observed running; used to detect the busy→idle edge. */
  const activeRuns = new Set<string>()

  // --- Current active session (from route) ---------------------------------

  const currentID = createMemo<string | undefined>(() => {
    const r = api.route.current
    if (r.name !== "session") return undefined
    const params = r.params as { sessionID?: string } | undefined
    return params?.sessionID
  })

  // Clear the unread flag on the session the user just navigated to.
  createEffect(() => {
    const cur = currentID()
    if (!cur) return
    const s = unread()
    if (!s.has(cur)) return
    const next = new Set(s)
    next.delete(cur)
    persistUnread(next)
  })

  // --- Event → refetch trigger ---------------------------------------------
  //
  // session.list() is an HTTP call, so we don't call it on every render.
  // Instead we bump a tick signal on events that could change the list.

  const [tick, setTick] = createSignal(0)
  const bump = () => setTick((n) => n + 1)

  onCleanup(
    api.event.on("session.status", (e) => {
      const sid = e.properties.sessionID
      const status = e.properties.status
      if (status.type === "busy" || status.type === "retry") {
        activeRuns.add(sid)
      } else if (status.type === "idle" && activeRuns.has(sid)) {
        activeRuns.delete(sid)
        // Mark unread ONLY if the user isn't already looking at this session.
        if (currentID() !== sid) {
          const next = new Set(unread())
          next.add(sid)
          persistUnread(next)
        }
      }
      bump()
    }),
  )
  onCleanup(api.event.on("session.error", bump))
  onCleanup(
    api.event.on("session.deleted", (e) => {
      // Drop from unread set if the session was deleted.
      const sid = e.properties.info.id
      if (unread().has(sid)) {
        const next = new Set(unread())
        next.delete(sid)
        persistUnread(next)
      }
      bump()
    }),
  )
  onCleanup(api.event.on("question.asked", bump))
  onCleanup(api.event.on("question.replied", bump))
  onCleanup(api.event.on("question.rejected", bump))
  onCleanup(api.event.on("permission.asked", bump))
  onCleanup(api.event.on("permission.replied", bump))

  // --- Session list --------------------------------------------------------

  const [sessions] = createResource<Session[], number>(
    () => tick(),
    async () => {
      try {
        const res = await api.client.session.list({ roots: true, limit: 40 })
        return res.data ?? []
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )

  /** Top N root sessions, most-recently-updated first. */
  const top = createMemo<Session[]>(() => {
    const list = sessions() ?? []
    return list
      .filter((s) => s.parentID === undefined)
      .slice()
      .sort((a, b) => b.time.updated - a.time.updated)
      .slice(0, MAX_SESSIONS)
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Sessions</b>
      </text>
      <Show when={top().length > 0} fallback={<text fg={theme().textMuted}>(no sessions)</text>}>
        <For each={top()}>
          {(s, i) => {
            const status = createMemo(() => api.state.session.status(s.id))
            const kind = createMemo(() => classify(api, s.id, status(), unread()))
            const marker = createMemo(() => markerFor(kind(), theme()))
            const isCurrent = createMemo(() => currentID() === s.id)

            const rowFg = createMemo(() => {
              if (isCurrent()) return theme().accent
              if (marker().attention) return theme().text
              return theme().textMuted
            })
            const rowBold = createMemo(() => isCurrent() || marker().attention)

            // Quick-switch index 1..9,0 to hint at ordinal position.
            const ordinal = () => ((i() + 1) % 10).toString()
            const label = createMemo(() => `${ordinal()}. ${truncate(s.title, TITLE_MAX)}`)

            return (
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => {
                  if (isCurrent()) return
                  api.route.navigate("session", { sessionID: s.id })
                }}
              >
                <text fg={marker().fg} wrapMode="none">
                  {marker().icon}
                </text>
                <text fg={rowFg()} wrapMode="none">
                  <Show when={rowBold()} fallback={label()}>
                    <b>{label()}</b>
                  </Show>
                </text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: SLOT_ORDER,
    slots: {
      sidebar_content() {
        return <SessionsView api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id: PLUGIN_ID,
  tui,
}

export default plugin
