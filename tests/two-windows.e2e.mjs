// 두 창 재현: 창 A 에 문서가 있고, 창 B 에서 사용자가 그 문서를 연다.
// 사용법: PW_CORE=<playwright-core 경로> CHROME_BIN=<Chromium 실행 파일> node tests/two-windows.e2e.mjs .
// 실제 Chromium 에 확장을 올린다. run-tests.sh 에는 넣지 않았다(브라우저가 필요). headless 라 포커스 검사는 참고용이다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE);
const EXT = path.resolve(process.argv[2]);
const CHROME = process.env.CHROME_BIN;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-2win-'));
const docPath = path.join(work, 'report.html');
fs.writeFileSync(docPath, '<title>REPORT-DOC</title><h1>report</h1>');
const docUrl = 'file://' + docPath;

const ctx = await chromium.launchPersistentContext(path.join(work, 'profile'), {
  executablePath: CHROME,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail) => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  ${detail}`); };

const docTabs = () => sw.evaluate(async (u) =>
  (await chrome.tabs.query({})).filter((t) => (t.url || t.pendingUrl) === u).map((t) => ({ id: t.id, win: t.windowId, active: t.active })), docUrl);

// 창 A: 문서
// 문서 탭만 있는 창은 탭을 옮기면 크롬이 닫으므로 빈 탭을 하나 같이 둔다
const winA = await sw.evaluate(async (u) => (await chrome.windows.create({ url: ['about:blank', u] })).id, docUrl);
await sleep(1500);
// 창 B: 사이드바(탭으로 띄움 — getCurrent() 가 이 창을 돌려준다)
const winB = await sw.evaluate(async (u) => (await chrome.windows.create({ url: u, focused: true })).id,
  `chrome-extension://${extId}/src/sidepanel.html`);
await sleep(1500);
console.log(`창 A=${winA}  창 B=${winB}  문서 탭=${JSON.stringify(await docTabs())}`);

// ── 시나리오 1: 창 B 사이드바에서 문서 행을 누른다
const panel = ctx.pages().find((p) => p.url().includes('sidepanel.html'));
await panel.locator('.row', { hasText: 'REPORT-DOC' }).first().click();
await sleep(1500);
let tabs = await docTabs();
let focused = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);
check('사이드바 클릭 → 문서가 창 B 로 온다', tabs.length === 1 && tabs[0].win === winB, JSON.stringify(tabs));
check('사이드바 클릭 → 포커스가 창 A 로 넘어가지 않는다', focused !== winA, `lastFocused=${focused}`);

// ── 시나리오 2: 문서를 창 A 로 되돌려 놓고, 창 B 에서 주소창으로 직접 연다
await sw.evaluate(async ({ id, a }) => chrome.tabs.move(id, { windowId: a, index: -1 }), { id: tabs[0].id, a: winA });
await sw.evaluate(async (w) => chrome.windows.update(w, { focused: true }), winB);
await sleep(800);
// 사용자가 창 B 에서 새 탭을 열어 주소를 친 것과 같은 모양(opener 없음, active)
await sw.evaluate(async ({ u, b }) => chrome.tabs.create({ windowId: b, url: u, active: true }), { u: docUrl, b: winB });
await sleep(2000);
tabs = await docTabs();
focused = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);
check('창 B 에서 직접 열기 → 문서가 창 B 에 하나', tabs.length === 1 && tabs[0].win === winB, JSON.stringify(tabs));
check('창 B 에서 직접 열기 → 포커스가 창 A 로 넘어가지 않는다', focused !== winA, `lastFocused=${focused}`);

await ctx.close();
fs.rmSync(work, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
