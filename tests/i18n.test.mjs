// 다국어 게이트. 확장을 로드하지 않고 잡을 수 있는 번역 사고를 막는다.
//  - 언어마다 키가 같은가 (한 언어에만 없으면 그 언어 사용자에게 키 이름이 그대로 보인다)
//  - 치환자($1…) 개수가 언어마다 같은가
//  - 코드·HTML·manifest 가 쓰는 키가 전부 있는가
//  - 영어·스페인어 번역에 한글이 남아 있지 않은가 (번역을 빠뜨린 흔적)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['ko', 'en', 'es'];
const HANGUL = /[가-힣]/;

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) fail++;
};

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const msgs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, '_locales', l, 'messages.json'), 'utf8'))])
);
check('default_locale 이 존재하는 언어', LOCALES.includes(manifest.default_locale), manifest.default_locale);

const base = Object.keys(msgs.en).sort();
for (const l of LOCALES) {
  const keys = Object.keys(msgs[l]).sort();
  const missing = base.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !base.includes(k));
  check(`${l}: 키 집합이 en 과 같다`, !missing.length && !extra.length, `누락 ${missing} / 초과 ${extra}`);
}

const phCount = (e) => Object.keys(e.placeholders || {}).length;
const phBad = base.filter((k) => new Set(LOCALES.map((l) => phCount(msgs[l][k] || {}))).size > 1);
check('치환자 개수가 언어마다 같다', !phBad.length, phBad.join(', '));

for (const l of ['en', 'es']) {
  const left = base.filter((k) => HANGUL.test(msgs[l][k].message));
  check(`${l}: 한글이 남은 번역 없음`, !left.length, left.join(', '));
}

// 코드·HTML·manifest 가 참조하는 키 수집
const used = new Set();
const srcFiles = readdirSync(join(ROOT, 'src'), { recursive: true }).filter((f) => /\.(js|html)$/.test(f) && !f.endsWith('i18n.js')); // 헬퍼 주석의 예시 키 제외
for (const f of srcFiles) {
  const text = readFileSync(join(ROOT, 'src', f), 'utf8');
  for (const m of text.matchAll(/data-i18n(?:-html|-placeholder|-title)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]);
  // STATE_LABEL 처럼 객체에 키를 모아 둔 경우
  for (const m of text.matchAll(/:\s*'(state[A-Z][A-Za-z]+)'/g)) used.add(m[1]);
}
for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
const undefinedKeys = [...used].filter((k) => !base.includes(k));
check(`코드가 쓰는 키 ${used.size}개가 전부 정의됨`, !undefinedKeys.length, undefinedKeys.join(', '));

// Chrome 웹스토어는 확장 이름 45자, 설명 132자를 넘으면 업로드를 거부한다.
for (const l of LOCALES) {
  check(`${l}: extName ≤ 45자`, [...msgs[l].extName.message].length <= 45);
  check(`${l}: extDescription ≤ 132자`, [...msgs[l].extDescription.message].length <= 132,
    [...msgs[l].extDescription.message].length);
}

if (fail) { console.log(`\n${fail}건 실패`); process.exit(1); }
console.log('\nOK');
