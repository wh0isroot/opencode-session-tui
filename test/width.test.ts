import { expect, test } from "bun:test"

import { truncate } from "../src/index.tsx"

const TITLE_MAX = 26

/**
 * Independent width oracle for the tests. Deliberately NOT the implementation's
 * helper — the test must measure the result, not trust the code under test.
 * East Asian Wide / Fullwidth code points render as 2 terminal columns.
 */
function refWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd)
    w += wide ? 2 : 1
  }
  return w
}

// --- ASCII regression lock: MUST hold identically before AND after the fix ---

test("ascii short title is returned unchanged", () => {
  expect(truncate("hello world", TITLE_MAX)).toBe("hello world")
})

test("ascii title exactly at the budget is returned unchanged", () => {
  expect(truncate("a".repeat(26), TITLE_MAX)).toBe("a".repeat(26))
})

test("ascii over-budget title keeps 25 chars + ellipsis (byte-identical to old behavior)", () => {
  expect(truncate("a".repeat(30), TITLE_MAX)).toBe("a".repeat(25) + "…")
})

test("empty title becomes (untitled)", () => {
  expect(truncate("", TITLE_MAX)).toBe("(untitled)")
})

// --- CJK bug capture: MUST FAIL before the fix, PASS after ---

test("pure CJK long title clips to the column budget with an ellipsis", () => {
  const out = truncate("漢".repeat(20), TITLE_MAX) // 40 display cols, .length === 20
  expect(refWidth(out)).toBeLessThanOrEqual(TITLE_MAX)
  expect(out.endsWith("…")).toBe(true)
})

test("mixed CJK/ASCII title (issue-screenshot shape) clips to the column budget", () => {
  const out = truncate("Prod-flyte日志传输链路部署 (fork test session)", TITLE_MAX)
  expect(refWidth(out)).toBeLessThanOrEqual(TITLE_MAX)
  expect(out.endsWith("…")).toBe(true)
})

test("a wide char is never half-included at the truncation boundary", () => {
  // 24 ASCII (24 cols) + 2 wide (4 cols) = 28 cols. The first 漢 cannot fit the
  // single column left after reserving one for the ellipsis.
  const out = truncate("a".repeat(24) + "漢漢", TITLE_MAX)
  expect(out).toBe("a".repeat(24) + "…")
})

test("clipped CJK row fits the sidebar label budget including the 'N. ' prefix", () => {
  const label = "1. " + truncate("非常长的中文标题会撑爆侧边栏面板的宽度预算", TITLE_MAX)
  expect(refWidth(label)).toBeLessThanOrEqual(31)
})
