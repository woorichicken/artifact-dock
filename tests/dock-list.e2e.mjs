// 실제 Chromium + 실제 확장 + 실제 호스트 + 소켓으로 `list` 를 잰다.
// 사용법: PW_CORE=<playwright-core 경로> CHROME_BIN=<Chromium 실행 파일> node tests/dock-list.e2e.mjs .
// run-tests.sh 에는 넣지 않았다(브라우저가 필요).
//
// 격리: 호스트는 시험용 프로필의 NativeMessagingHosts 로 등록하고 ARTIFACT_DOCK_SOCKET 로 시험 소켓을 쓴다.
// 돌고 있는 사람 Chrome 의 소켓은 건드리지 않는다 — 시험 전후에 그 파일이 같은지 마지막에 본다.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_CORE);
const EXT = path.resolve(process.argv[2]);
const CHROME = process.env.CHROME_BIN;
const HOST_NAME = 'dev.artifactdock.host';
const REAL_SOCKET = path.join(os.homedir(), 'Library/Application Support/ArtifactDock/dock.sock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
};

const socketFingerprint = (file) => {
  try {
    const s = fs.lstatSync(file);
    return `${s.ino}:${s.mtimeMs}`;
  } catch {
    return 'none';
  }
};
const realSocketBefore = socketFingerprint(REAL_SOCKET);

/** manifest key 로 확장 id 를 계산한다 — 호스트 등록(allowed_origins)은 브라우저를 띄우기 전에 필요하다. */
function extensionId(root) {
  const { key } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-list-'));
// 유닉스 소켓 경로는 104바이트 제한이 있어서 짧은 곳에 둔다
const SOCK = `/tmp/ad-list-${process.pid}.sock`;
const profile = path.join(work, 'profile');
const docs = path.join(work, 'docs');
fs.mkdirSync(docs, { recursive: true });

// 호스트는 복사본을 쓴다(~/Downloads 아래 스크립트는 브라우저가 못 띄울 수 있다 — docs/backlog.md)
const hostCopy = path.join(work, 'artifact_dock_host.py');
fs.copyFileSync(path.join(EXT, 'host/artifact_dock_host.py'), hostCopy);
const wrapper = path.join(work, 'host.sh');
fs.writeFileSync(wrapper, `#!/bin/sh\nARTIFACT_DOCK_SOCKET='${SOCK}' exec /usr/bin/python3 '${hostCopy}' "$@"\n`, { mode: 0o755 });
fs.mkdirSync(path.join(profile, 'NativeMessagingHosts'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`),
  JSON.stringify({ name: HOST_NAME, description: 'test', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId(EXT)}/`] })
);

const docFile = (name) => path.join(docs, `${name}.html`);
const writeDoc = (name) => fs.writeFileSync(docFile(name), `<title>${name}</title><h1>${name}</h1>`);

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  // env 는 호스트까지 이어진다. 혹시 다른 등록 파일을 집어도 사람 소켓을 지우지 못한다.
  env: { ...process.env, ARTIFACT_DOCK_SOCKET: SOCK },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--headless=new'],
});

let exitCode = 1;
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  check('확장 id 계산이 맞다', extId === extensionId(EXT), extId);

  for (let i = 0; i < 100 && !fs.existsSync(SOCK); i++) await sleep(100);
  if (!fs.existsSync(SOCK)) throw new Error('시험 소켓이 안 생겼다 — 호스트가 안 떴다');

  /** CLI Manager 가 보내는 것과 같은 바이트. 한 줄 보내고 한 줄 받는다. */
  const ask = (raw, timeoutMs = 2500) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      const client = net.createConnection(SOCK);
      let buf = '';
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error(`${timeoutMs}ms 안에 답이 없다`));
      }, timeoutMs);
      client.on('connect', () => client.write(raw));
      client.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        if (!buf.includes('\n')) return;
        clearTimeout(timer);
        client.destroy();
        resolve({ reply: JSON.parse(buf.slice(0, buf.indexOf('\n'))), ms: performance.now() - started });
      });
      client.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  const list = async () => (await ask('{"cmd":"list","v":1}\n')).reply;

  const artifactOpen = (name, sessionId) => {
    const env = { ...process.env, ARTIFACT_DOCK_SOCKET: SOCK, ARTIFACT_OPEN_QUIET: '1' };
    delete env.CLIMANAGER_SESSION_ID;
    if (sessionId !== undefined) env.CLIMANAGER_SESSION_ID = sessionId;
    execFileSync('bash', [path.join(EXT, 'bin/artifact-open'), docFile(name)], { env, stdio: 'ignore' });
  };

  // ── 문서를 깐다: 세션이 다른 셋 + 세션 없는 하나 + 닫을 둘
  for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) writeDoc(name);
  artifactOpen('alpha', 'session-a');
  await sleep(150);
  artifactOpen('bravo', 'session-b');
  await sleep(150);
  artifactOpen('charlie');
  await sleep(150);
  artifactOpen('delta', 'session-d');
  await sleep(150);
  artifactOpen('echo');
  await sleep(150);
  artifactOpen('foxtrot');
  await sleep(1200);

  // 시간순 그대로면 정렬을 안 재는 셈이라, alpha 를 고정해서 맨 위로 올린다(사이드바 버튼으로)
  await sw.evaluate(async (u) => chrome.tabs.create({ url: u, active: false }), `chrome-extension://${extId}/src/sidepanel.html`);
  await sleep(800);
  const panel = ctx.pages().find((p) => p.url().includes('sidepanel.html'));
  await panel.locator('.row', { hasText: 'alpha' }).first().hover();
  await panel.locator('.row', { hasText: 'alpha' }).first().locator('.icon-btn').first().click();
  await sleep(400);

  // delta·foxtrot 는 닫아서 「최근 닫힘」으로, foxtrot 은 파일까지 지운다
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    await chrome.tabs.remove(tabs.filter((t) => /(delta|foxtrot)\.html$/.test(t.url || t.pendingUrl || '')).map((t) => t.id));
  });
  fs.rmSync(docFile('foxtrot'));
  await sleep(800);

  // ── 응답 모양
  const first = await list();
  check('list 응답 ok', first?.ok === true, `ok=${first?.ok} error=${first?.error ?? ''}`);
  check('프로토콜·버전', first.protocol === 1 && first.extVersion === JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, `${first.protocol} ${first.extVersion}`);
  check('최상위에 cmd 없음(호스트가 명령으로 오인)', !('cmd' in first));
  // 닫힌 문서 제목은 파일명일 수도 있다(기록을 쓴 시점에 탭 제목이 아직 없으면). 이름은 확장자를 떼고 비교한다.
  const nameOf = (r) => r.title.replace(/\.html$/, '');
  const allRows = [...first.open, ...first.closed];
  check('탭·창·활성·파비콘·중복은 안 나간다', allRows.every((r) => !['tabId', 'windowId', 'isActive', 'favIconUrl', 'dupes'].some((k) => k in r)));
  check('열린 묶음', first.open.map(nameOf).join() === 'alpha,echo,charlie,bravo', first.open.map(nameOf).join());
  check('닫힌 묶음', first.closed.map(nameOf).join() === 'foxtrot,delta', first.closed.map(nameOf).join());
  const row = (name) => allRows.find((r) => nameOf(r) === name);
  check('고정 표시', row('alpha').pinned === true && row('echo').pinned === false);
  check('세션: artifact-open 이 넘긴 값', row('alpha').sessionId === 'session-a' && row('delta').sessionId === 'session-d');
  check('세션: 없으면 칸이 없다', !('sessionId' in row('charlie')));
  check('지워진 파일 표시', first.missingSupported === true && row('foxtrot').missing === true && row('delta').missing === false);

  // ── 사이드바 DOM 순서 = list 응답 순서
  const domOrder = async () => {
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'dock:refresh' }).catch(() => {}));
    await sleep(300);
    return panel.evaluate(() => [...document.querySelectorAll('#list .row')].map((r) => r.querySelector('.name').textContent));
  };
  const reply = await list();
  const panelNames = await domOrder();
  const listNames = [...reply.open, ...reply.closed].map((r) => r.title);
  check('사이드바 순서 = list 순서', JSON.stringify(panelNames) === JSON.stringify(listNames), panelNames.join());

  // ── list 는 읽기만 한다 (0.6.1·0.6.2 되돌림의 재발 방지)
  const snapshot = () =>
    sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const windows = await chrome.windows.getAll();
      const { history = [] } = await chrome.storage.local.get('history');
      return {
        tabs: tabs.map((t) => [t.id, t.windowId, t.index, t.active, t.groupId, t.url, t.status]),
        windows: windows.map((w) => [w.id, w.focused]),
        history: history.map((h) => [h.key, h.at, h.pinned, h.sessionId]),
      };
    });
  const before = await snapshot();
  const times = [];
  for (let i = 0; i < 20; i++) times.push((await ask('{"cmd":"list","v":1}\n')).ms);
  const after = await snapshot();
  check('list 20회 뒤 탭·창·활성 탭 그대로', JSON.stringify(before.tabs) === JSON.stringify(after.tabs) && JSON.stringify(before.windows) === JSON.stringify(after.windows));
  check('list 20회 뒤 기록(at) 그대로', JSON.stringify(before.history) === JSON.stringify(after.history));
  times.sort((a, b) => a - b);
  console.log(`     실측 왕복(실제 확장, ${allRows.length}행): 중앙값 ${times[10].toFixed(1)}ms · 최대 ${times[19].toFixed(1)}ms`);
  check('왕복이 2.5초 안', times[19] < 2500);

  // ── 세션 규칙
  artifactOpen('bravo', 'session-z');
  await sleep(500);
  let now = await list();
  let bravo = now.open.find((r) => nameOf(r) === 'bravo');
  check('다른 세션이 다시 열면 그 세션이 이긴다', bravo.sessionId === 'session-z', bravo.sessionId);
  artifactOpen('bravo');
  await sleep(500);
  now = await list();
  bravo = now.open.find((r) => nameOf(r) === 'bravo');
  check('id 없이 다시 열면 이전 값을 지킨다', bravo.sessionId === 'session-z', String(bravo.sessionId));
  artifactOpen('bravo', '../bad value');
  await sleep(500);
  now = await list();
  bravo = now.open.find((r) => nameOf(r) === 'bravo');
  check('이상한 id 는 무시한다', bravo.sessionId === 'session-z', String(bravo.sessionId));

  // 새로 열면 onCreated 와 openFromCli 가 겹칠 수 있다. 값이 사라지면 안 된다.
  const burst = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
  burst.forEach(writeDoc);
  // execFileSync 는 차례로 돌아서 겹치지 않는다. 같은 순간에 소켓으로 보내야 겹친다.
  await Promise.all(
    burst.map((name) =>
      ask(`${JSON.stringify({ cmd: 'open', url: `file://${docFile(name)}`, activate: false, sessionId: `session-${name}` })}\n`, 8000)
    )
  );
  await sleep(1200);
  now = await list();
  const lost = burst.filter((name) => now.open.find((r) => nameOf(r) === name)?.sessionId !== `session-${name}`);
  check('빠르게 연 문서도 세션을 안 잃는다', lost.length === 0, lost.join());

  const panelAfter = await domOrder();
  const listAfter = [...now.open, ...now.closed].map((r) => r.title);
  check('다시 열어도 사이드바 순서 = list 순서', JSON.stringify(panelAfter) === JSON.stringify(listAfter), panelAfter.join());

  exitCode = results.every(Boolean) ? 0 : 1;
} catch (error) {
  console.log(`FAIL 시험 중단: ${error.message}`);
  exitCode = 1;
} finally {
  await ctx.close().catch(() => {});
  check('사람 Chrome 의 소켓은 그대로', socketFingerprint(REAL_SOCKET) === realSocketBefore, realSocketBefore);
  if (!results.every(Boolean)) exitCode = 1;
  fs.rmSync(SOCK, { force: true });
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
