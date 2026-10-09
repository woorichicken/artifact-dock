// 웹스토어 업로드 스크립트(publish-cws · cws-auth) 검사. 네트워크 없이 가짜 fetch 로 돈다.
// 핵심: 순서·요청 모양이 공식 문서와 같은가, 실패가 사람이 읽을 문장으로 나오는가, 자격증명 값이 어디에도 안 찍히는가.
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as publish from '../scripts/publish-cws.mjs';
import * as auth from '../scripts/cws-auth.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const has = (label, text, part) => eq(label, String(text).includes(part), true);

// ── 픽스처: manifest + 웹스토어용 zip
const root = mkdtempSync(join(tmpdir(), 'cws-test-'));
const VERSION = '9.9.9';
writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: VERSION, key: 'dev-only' }));
const stage = mkdtempSync(join(tmpdir(), 'cws-stage-'));
writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version: VERSION }));
mkdirSync(join(root, 'dist'));
const ZIP = join(root, 'dist', `artifact-dock-${VERSION}.zip`);
execFileSync('zip', ['-q', ZIP, 'manifest.json'], { cwd: stage });
const ZIP_BYTES = readFileSync(ZIP).length;

const SECRETS = {
  CWS_CLIENT_ID: 'SENTINEL-CLIENT-ID',
  CWS_CLIENT_SECRET: 'SENTINEL-CLIENT-SECRET',
  CWS_REFRESH_TOKEN: 'SENTINEL-REFRESH',
  CWS_PUBLISHER_ID: 'SENTINEL-PUBLISHER',
};
const ACCESS = 'SENTINEL-ACCESS';
const leaks = (text) => [...Object.values(SECRETS), ACCESS].filter((v) => text.includes(v));

/** 응답 목록을 순서대로 돌려주고 요청을 기록하는 가짜 fetch */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers || {}, body: init.body });
    const next = responses.shift();
    if (!next) throw new Error('예상보다 요청이 많다: ' + url);
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  };
  fn.calls = calls;
  return fn;
}
const noFetch = async () => { throw new Error('dry-run 인데 네트워크를 썼다'); };

async function runPublish(argv, { env = SECRETS, fetch = noFetch } = {}) {
  const out = [];
  let code;
  let error = null;
  try {
    code = await publish.run({ argv, env, fetch, root, log: (l) => out.push(l), sleep: async () => {} });
  } catch (e) {
    error = e;
    code = 1;
  }
  const text = out.join('\n') + (error ? `\n${error.message}` : '');
  return { code, text, error };
}

const TOKEN_OK = { body: { access_token: ACCESS, expires_in: 3600, token_type: 'Bearer' } };
const STATUS_PENDING = {
  body: {
    name: 'publishers/x/items/y',
    submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: VERSION, deployPercentage: 100 }] },
    publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '9.9.8', deployPercentage: 100 }] },
    lastAsyncUploadState: 'SUCCEEDED',
  },
};

// ── 인자·환경변수
eq('기본 옵션', publish.parseArgs([]), { dryRun: false, zip: null, publish: true, staged: false, statusOnly: false, help: false });
eq('비어 있는 환경변수는 이름만', publish.missingEnv({ CWS_CLIENT_ID: 'x', CWS_REFRESH_TOKEN: ' ' }),
  ['CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID']);
eq('확장 ID 기본값', publish.extensionIdOf({}), 'nfifnjdpmjacfelfapgeibnnbkokceim');

// ── dry-run: 네트워크 0, 자격증명 값 0
{
  const r = await runPublish(['--dry-run']);
  eq('dry-run 종료코드 0', r.code, 0);
  has('dry-run 은 업로드 URL 을 보여 준다', r.text, '/upload/v2/publishers/{CWS_PUBLISHER_ID}/items/nfifnjdpmjacfelfapgeibnnbkokceim:upload');
  has('dry-run 은 zip·버전을 보여 준다', r.text, `artifact-dock-${VERSION}.zip (v${VERSION})`);
  eq('dry-run 출력에 자격증명 값 없음', leaks(r.text), []);
  const empty = await runPublish(['--dry-run'], { env: {} });
  has('환경변수가 없어도 dry-run 은 무엇이 비었는지 알려 준다', empty.text, 'CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID');
}

// ── 전체 흐름: 토큰 → 업로드(SUCCEEDED) → 제출 → 상태
{
  const f = fakeFetch([TOKEN_OK, { body: { uploadState: 'SUCCEEDED', crxVersion: VERSION } }, { body: { state: 'PENDING_REVIEW' } }, STATUS_PENDING]);
  const r = await runPublish([], { fetch: f });
  eq('성공 종료코드 0', r.code, 0);
  eq('요청 순서', f.calls.map((c) => `${c.method} ${c.url.replace(/publishers\/[^/]+/, 'publishers/P')}`), [
    'POST https://oauth2.googleapis.com/token',
    'POST https://chromewebstore.googleapis.com/upload/v2/publishers/P/items/nfifnjdpmjacfelfapgeibnnbkokceim:upload',
    'POST https://chromewebstore.googleapis.com/v2/publishers/P/items/nfifnjdpmjacfelfapgeibnnbkokceim:publish',
    'GET https://chromewebstore.googleapis.com/v2/publishers/P/items/nfifnjdpmjacfelfapgeibnnbkokceim:fetchStatus',
  ]);
  const form = new URLSearchParams(f.calls[0].body);
  eq('토큰 요청은 refresh_token grant', [form.get('grant_type'), form.get('refresh_token')], ['refresh_token', SECRETS.CWS_REFRESH_TOKEN]);
  eq('업로드는 Bearer 토큰', f.calls[1].headers.Authorization, `Bearer ${ACCESS}`);
  eq('업로드는 공식 예시(curl -T)처럼 Content-Type 없이 zip 바이트만', [Object.keys(f.calls[1].headers), f.calls[1].body.length], [['Authorization'], ZIP_BYTES]);
  eq('기본 제출은 본문 없음', f.calls[2].body, undefined);
  has('심사 상태를 사람이 읽게 출력', r.text, '제출본: PENDING_REVIEW · 심사 대기 · v9.9.9');
  has('게시본도 출력', r.text, '게시본: PUBLISHED · 공개 게시됨 · v9.9.8');
  eq('출력에 자격증명·토큰 값 없음', leaks(r.text), []);
}

// ── 업로드가 처리 중이면 fetchStatus 로 기다린다 (문서 표기 둘 다)
for (const pending of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
  const f = fakeFetch([
    TOKEN_OK,
    { body: { uploadState: pending } },
    { body: { lastAsyncUploadState: 'IN_PROGRESS' } },
    { body: { lastAsyncUploadState: 'SUCCEEDED' } },
    { body: { state: 'PENDING_REVIEW' } },
    STATUS_PENDING,
  ]);
  const r = await runPublish([], { fetch: f });
  eq(`${pending}: 처리 끝날 때까지 기다린 뒤 제출`, [r.code, f.calls.length], [0, 6]);
}

// ── 실패는 문장으로
{
  const f = fakeFetch([TOKEN_OK, { body: { uploadState: 'IN_PROGRESS' } }, { body: { lastAsyncUploadState: 'FAILED' } }]);
  const r = await runPublish([], { fetch: f });
  eq('업로드 처리 실패 → 종료코드 1', r.code, 1);
  has('업로드 실패 이유', r.text, '업로드 처리 실패 — FAILED');
}
{
  const f = fakeFetch([{ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]);
  const r = await runPublish([], { fetch: f });
  eq('토큰 만료 → 종료코드 1, 업로드 시도 안 함', [r.code, f.calls.length], [1, 1]);
  has('만료 안내에 다시 받는 방법', r.text, 'node scripts/cws-auth.mjs');
  has('7일 만료 조건을 알려 준다', r.text, '7일');
  eq('실패 출력에도 자격증명 값 없음', leaks(r.text), []);
}
{
  const f = fakeFetch([TOKEN_OK, { status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Chrome Web Store API has not been used in project 123 before or it is disabled.' } } }]);
  const r = await runPublish([], { fetch: f });
  has('API 꺼짐 → 사용 설정 안내', r.text, 'Chrome Web Store API 가 꺼져 있습니다');
}
{
  const f = fakeFetch([TOKEN_OK, { body: { uploadState: 'SUCCEEDED' } }, { status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'Item not found.' } } }]);
  const r = await runPublish([], { fetch: f });
  has('404 → 퍼블리셔 ID 확인 안내', r.text, 'CWS_PUBLISHER_ID(개발자 대시보드 › 퍼블리셔 › 설정)');
}
{
  const f = fakeFetch([new TypeError('fetch failed')]);
  const r = await runPublish([], { fetch: f });
  has('네트워크 오류도 문장으로', r.text, '토큰 발급 실패 — 네트워크 오류');
}
eq('알 수 없는 토큰 오류도 HTTP 와 코드를 남긴다',
  publish.describeTokenError(400, { error: 'weird', error_description: 'x' }), '액세스 토큰을 받지 못했습니다 — HTTP 400 weird (x).');
has('버전을 안 올린 업로드 → 버전 안내',
  publish.describeApiError('업로드', 400, { error: { message: 'Invalid version. Version must be greater than 0.5.0' } }), 'version 을');

// ── 옵션
{
  const f = fakeFetch([TOKEN_OK, { body: { uploadState: 'SUCCEEDED' } }, { body: { state: 'PENDING_REVIEW' } }, STATUS_PENDING]);
  await runPublish(['--staged'], { fetch: f });
  eq('--staged 는 STAGED_PUBLISH', JSON.parse(f.calls[2].body), { publishType: 'STAGED_PUBLISH' });
}
{
  const f = fakeFetch([TOKEN_OK, { body: { uploadState: 'SUCCEEDED' } }]);
  const r = await runPublish(['--no-publish'], { fetch: f });
  eq('--no-publish 는 업로드까지만', [r.code, f.calls.length], [0, 2]);
}
{
  const f = fakeFetch([TOKEN_OK, STATUS_PENDING]);
  const r = await runPublish(['--status'], { fetch: f });
  eq('--status 는 토큰 + 상태만', [r.code, f.calls.map((c) => c.method)], [0, ['POST', 'GET']]);
}
{
  const r = await runPublish([], { env: { CWS_CLIENT_ID: 'x' } });
  eq('환경변수 없으면 네트워크 전에 멈춘다', r.code, 1);
  has('빈 이름을 알려 준다', r.text, 'CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID');
  const wrongZip = await runPublish(['--zip', join(root, 'nope.zip')], { fetch: noFetch });
  has('zip 이 없으면 build-cws.sh 안내', wrongZip.text, 'scripts/build-cws.sh');
}
{
  const bad = join(root, 'old.zip');
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
  execFileSync('zip', ['-q', bad, 'manifest.json'], { cwd: stage });
  const r = await runPublish(['--zip', bad], { fetch: noFetch });
  has('버전이 다른 zip 은 거부', r.text, 'zip 의 버전(1.0.0)이 manifest.json(9.9.9)과 다릅니다');
  const keyed = join(root, 'keyed.zip');
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ version: VERSION, key: 'x' }));
  execFileSync('zip', ['-q', keyed, 'manifest.json'], { cwd: stage });
  has('key 가 남은 zip 은 거부', (await runPublish(['--zip', keyed], { fetch: noFetch })).text, '"key" 가 남아 있습니다');
}

// ── cws-auth
{
  const { verifier, challenge } = auth.pkcePair();
  const expect = createHash('sha256').update(verifier).digest('base64url');
  eq('PKCE challenge = base64url(sha256(verifier))', [challenge, verifier.length >= 43 && verifier.length <= 128], [expect, true]);
  const u = new URL(auth.authUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge, state: 's1' }));
  eq('승인 주소 파라미터', ['scope', 'access_type', 'prompt', 'code_challenge_method', 'response_type'].map((k) => u.searchParams.get(k)),
    ['https://www.googleapis.com/auth/chromewebstore', 'offline', 'consent', 'S256', 'code']);
  eq('state 가 맞으면 code', auth.parseCallback('/?state=s1&code=abc', 's1'), 'abc');
  let err = '';
  try { auth.parseCallback('/?state=other&code=abc', 's1'); } catch (e) { err = e.message; }
  has('state 가 다르면 거부', err, 'state 가 맞지 않습니다');
  try { auth.parseCallback('/?error=access_denied&state=s1', 's1'); } catch (e) { err = e.message; }
  has('거부하면 테스트 사용자 안내', err, '테스트 사용자');
  try { auth.writeEnvFile(join(REPO, 'cws.env'), { A: 'b' }, REPO); err = ''; } catch (e) { err = e.message; }
  has('저장소 안에는 자격증명을 쓰지 않는다', err, '저장소 안');
}
{
  const out = join(mkdtempSync(join(tmpdir(), 'cws-env-')), 'sub', 'cws.env');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, "CWS_PUBLISHER_ID='pub'\nCWS_REFRESH_TOKEN='old'\n");
  auth.writeEnvFile(out, { CWS_REFRESH_TOKEN: 'new', CWS_CLIENT_ID: 'cid' }, REPO);
  eq('기존 줄은 남기고 토큰만 바꾼다', readFileSync(out, 'utf8'), "CWS_PUBLISHER_ID='pub'\nCWS_REFRESH_TOKEN='new'\nCWS_CLIENT_ID='cid'\n");
  eq('파일 권한 600', (statSync(out).mode & 0o777).toString(8), '600');
}

// 루프백 왕복: 승인 주소를 출력 → 브라우저 대신 그 포트로 code 를 보낸다 → 토큰 교환 → 파일 저장
async function authRoundTrip(callbackQuery, tokenResponse, extraArgs = []) {
  const out = join(mkdtempSync(join(tmpdir(), 'cws-auth-')), 'cws.env');
  const logs = [];
  const f = fakeFetch([tokenResponse]);
  let sawUrl;
  const urlSeen = new Promise((r) => (sawUrl = r));
  const running = auth.run({
    argv: ['--out', out, '--timeout', '5', ...extraArgs],
    env: { CWS_CLIENT_ID: SECRETS.CWS_CLIENT_ID, CWS_CLIENT_SECRET: SECRETS.CWS_CLIENT_SECRET },
    fetch: f,
    repoRoot: REPO,
    log: (l) => { logs.push(l); if (l.startsWith('https://accounts.google.com/')) sawUrl(l); },
  }).then((c) => ({ code: c }), (e) => ({ code: 1, error: e }));
  const u = new URL(await urlSeen);
  const redirect = u.searchParams.get('redirect_uri');
  const state = u.searchParams.get('state');
  const res = await fetch(`${redirect}/?${callbackQuery(state)}`);
  const result = await running;
  return { ...result, out, logs: logs.join('\n'), page: await res.text(), status: res.status, calls: f.calls, redirect };
}
{
  const r = await authRoundTrip((s) => `state=${s}&code=AUTHCODE`, { body: { refresh_token: 'SENTINEL-NEW-REFRESH', access_token: ACCESS } });
  eq('루프백 왕복 성공', [r.code, r.status], [0, 200]);
  eq('리다이렉트는 127.0.0.1 루프백', /^http:\/\/127\.0\.0\.1:\d+$/.test(r.redirect), true);
  const form = new URLSearchParams(r.calls[0].body);
  eq('code 교환에 PKCE verifier · 같은 redirect_uri', [form.get('grant_type'), form.get('code'), !!form.get('code_verifier'), form.get('redirect_uri')],
    ['authorization_code', 'AUTHCODE', true, r.redirect]);
  has('refresh token 을 파일에 저장', readFileSync(r.out, 'utf8'), "CWS_REFRESH_TOKEN='SENTINEL-NEW-REFRESH'");
  eq('저장 파일 권한 600', (statSync(r.out).mode & 0o777).toString(8), '600');
  // client_id 는 승인 주소에 들어갈 수밖에 없다(OAuth 규격상 브라우저로 가는 공개값). 시크릿·토큰은 없어야 한다.
  eq('출력에 시크릿·토큰 값 없음(client_id 는 승인 주소에만)',
    { leaks: leaks(r.logs), newToken: r.logs.includes('SENTINEL-NEW-REFRESH') }, { leaks: [SECRETS.CWS_CLIENT_ID], newToken: false });
}
{
  const r = await authRoundTrip((s) => `state=${s}&code=AUTHCODE`, { status: 401, body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } });
  eq('토큰 교환 실패 → 종료코드 1', r.code, 1);
  has('클라이언트 오류는 문장으로', r.error?.message, 'OAuth 클라이언트를 찾을 수 없거나');
}
{
  const r = await authRoundTrip(() => 'state=forged&code=AUTHCODE', { body: {} });
  eq('state 위조 → 400, 토큰 교환 안 함', [r.code, r.status, r.calls.length], [1, 400, 0]);
}

rmSync(root, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
if (fail) { console.log(`\n${fail}건 실패`); process.exit(1); }
console.log('\nOK');
