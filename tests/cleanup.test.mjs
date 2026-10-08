// 목록 정리 규칙. 지우면 안 되는 것(📌 고정 · 보고 있는 탭 · Chrome 고정 탭)이 남는지가 핵심이다.
import { planAgeCleanup, planMissingCleanup, missingKeysFrom, DAY_MS } from '../src/lib/cleanup.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};
const sorted = (a) => [...a].sort();

const now = Date.UTC(2026, 9, 9);
const ago = (d) => now - d * DAY_MS;

// ── 오래된 문서
const history = [
  { key: 'old-closed', at: ago(10) },
  { key: 'new-closed', at: ago(1) },
  { key: 'old-pinned', at: ago(30), pinned: true },
  { key: 'old-open', at: ago(10) },
  { key: 'old-but-viewed', at: ago(10) },
  { key: 'old-active', at: ago(10) },
  { key: 'old-chrome-pinned', at: ago(10) },
];
const tabs = [
  { id: 1, key: 'old-open', lastAccessed: ago(9) },
  { id: 2, key: 'old-but-viewed', lastAccessed: ago(2) },
  { id: 3, key: 'old-active', lastAccessed: ago(10), active: true },
  { id: 4, key: 'old-chrome-pinned', lastAccessed: ago(10), pinned: true },
  { id: 5, key: 'old-pinned', lastAccessed: ago(30) },
  { id: 6, key: 'no-history', lastAccessed: ago(8) },
];
const age = planAgeCleanup({ history, tabs, now, days: 7 });
eq('7일: 오래 안 본 탭만 닫는다', sorted(age.closeTabIds), [1, 6]);
eq('7일: 닫히는 문서와 닫힌 오래된 문서만 목록에서 지운다', sorted(age.dropKeys), ['old-closed', 'old-open']);
eq('0일이면 끔', planAgeCleanup({ history, tabs, now, days: 0 }), { closeTabIds: [], dropKeys: [] });
eq('문자열 "0" 도 끔(설정은 문자열로 저장된다)', planAgeCleanup({ history, tabs, now, days: Number('0') }).closeTabIds, []);
eq('경계: 정확히 N일 전은 남긴다',
  planAgeCleanup({ history: [{ key: 'edge', at: ago(7) }], tabs: [], now, days: 7 }).dropKeys, []);

// ── 지워진 파일
const mHistory = [
  { key: 'gone-closed', at: ago(1) },
  { key: 'gone-open', at: ago(1) },
  { key: 'gone-active', at: ago(1) },
  { key: 'gone-pinned', at: ago(1), pinned: true },
  { key: 'alive', at: ago(1) },
];
const mTabs = [
  { id: 11, key: 'gone-open' },
  { id: 12, key: 'gone-active', active: true },
  { id: 13, key: 'alive' },
];
const missing = new Set(['gone-closed', 'gone-open', 'gone-active', 'gone-pinned']);
const auto = planMissingCleanup({ history: mHistory, tabs: mTabs, missingKeys: missing, closeTabs: false });
eq('자동: 탭은 닫지 않는다', auto.closeTabIds, []);
eq('자동: 닫혀 있는 지워진 문서만 목록에서 지운다', auto.dropKeys, ['gone-closed']);
const manual = planMissingCleanup({ history: mHistory, tabs: mTabs, missingKeys: missing, closeTabs: true });
eq('[정리]: 보고 있지 않은 탭은 닫는다', manual.closeTabIds, [11]);
eq('[정리]: 고정 문서·보고 있는 탭의 문서는 목록에 남는다', sorted(manual.dropKeys), ['gone-closed', 'gone-open']);
eq('지워진 게 없으면 아무것도 안 한다',
  planMissingCleanup({ history: mHistory, tabs: mTabs, missingKeys: [], closeTabs: true }), { closeTabIds: [], dropKeys: [] });

// ── 경로 → 키
const byKey = new Map([
  ['a', new Set(['/tmp/a.html'])],
  ['title:Report', new Set(['/tmp/r1.html', '/tmp/r2.html'])],
  ['title:Half', new Set(['/tmp/h1.html', '/tmp/h2.html'])],
  ['unknown', new Set(['/tmp/u.html'])],
]);
const exists = { '/tmp/a.html': false, '/tmp/r1.html': false, '/tmp/r2.html': false, '/tmp/h1.html': false, '/tmp/h2.html': true };
eq('경로가 여럿이면 전부 없어야 지워진 것 · 확인 못 한 경로는 있는 것으로', missingKeysFrom(byKey, exists), ['a', 'title:Report']);

if (fail) { console.log(`\n${fail}건 실패`); process.exit(1); }
console.log('\nOK');
