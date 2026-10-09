#!/usr/bin/env node
// Chrome 웹스토어에 새 버전을 올리고 심사에 제출한다. 의존성 없이 Node 내장 fetch 만 쓴다.
//
//   scripts/build-cws.sh && node scripts/publish-cws.mjs
//
// 흐름 (Chrome Web Store API v2 — https://developer.chrome.com/docs/webstore/using-api)
//   1) refresh token → access token          POST https://oauth2.googleapis.com/token
//   2) zip 업로드                              POST /upload/v2/publishers/{pub}/items/{id}:upload
//   3) 처리 중이면 끝날 때까지 상태 확인          GET  /v2/publishers/{pub}/items/{id}:fetchStatus
//   4) 심사 제출                               POST /v2/publishers/{pub}/items/{id}:publish
//   5) 심사 상태 출력                           GET  …:fetchStatus
//
// 자격증명은 환경변수로만 받고, 값은 어디에도 출력하지 않는다(오류 메시지에도).
//   CWS_CLIENT_ID · CWS_CLIENT_SECRET · CWS_REFRESH_TOKEN · CWS_PUBLISHER_ID
//   CWS_EXTENSION_ID (기본: 스토어에 올라간 Artifact Dock)
// refresh token 은 scripts/cws-auth.mjs 로 처음 한 번 받는다.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const API_BASE = 'https://chromewebstore.googleapis.com';
export const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
export const DEFAULT_EXTENSION_ID = 'nfifnjdpmjacfelfapgeibnnbkokceim';
export const REQUIRED_ENV = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID'];

// 업로드가 IN_PROGRESS 로 돌아오면 fetchStatus 로 끝날 때까지 본다. 문서에 간격이 없어서 3초 × 20번(1분)으로 묶는다.
const POLL_INTERVAL_MS = 3000;
const POLL_LIMIT = 20;

// 문서의 UploadState 는 IN_PROGRESS 인데, 같은 문서의 업로드 설명·가이드는 UPLOAD_IN_PROGRESS 로 적혀 있다 → 둘 다 받는다.
const UPLOAD_PENDING = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);

const ITEM_STATE_KO = {
  PENDING_REVIEW: '심사 대기',
  STAGED: '승인됨 — 게시 대기(대시보드에서 게시)',
  PUBLISHED: '공개 게시됨',
  PUBLISHED_TO_TESTERS: '테스터에게 게시됨',
  REJECTED: '거절됨',
  CANCELLED: '제출 취소됨',
};

const HELP = `사용: node scripts/publish-cws.mjs [옵션]

  (옵션 없음)     zip 업로드 → 심사 제출 → 상태 출력
  --dry-run      네트워크 없이 무엇을 할지만 보여 준다
  --zip <경로>   올릴 zip (기본: dist/artifact-dock-<manifest 버전>.zip)
  --no-publish   업로드만 하고 제출하지 않는다
  --staged       승인 뒤 바로 게시하지 않고 대기(STAGED)시킨다
  --status       업로드·제출 없이 현재 심사 상태만 본다
  -h, --help

환경변수: ${REQUIRED_ENV.join(' · ')} · CWS_EXTENSION_ID(선택)`;

/** 사람이 읽을 문장으로 끝나는 오류. 스택 대신 이 메시지만 보여 준다. */
export class CwsError extends Error {}

export function parseArgs(argv) {
  const opts = { dryRun: false, zip: null, publish: true, staged: false, statusOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-publish') opts.publish = false;
    else if (a === '--staged') opts.staged = true;
    else if (a === '--status') opts.statusOnly = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--zip') {
      opts.zip = argv[++i];
      if (!opts.zip) throw new CwsError('--zip 뒤에 zip 경로가 필요합니다.');
    } else throw new CwsError(`모르는 옵션: ${a}\n\n${HELP}`);
  }
  return opts;
}

/** 비어 있는 환경변수의 "이름"만 돌려준다 (값은 다루지 않는다) */
export function missingEnv(env) {
  return REQUIRED_ENV.filter((k) => !String(env[k] ?? '').trim());
}

export function extensionIdOf(env) {
  return String(env.CWS_EXTENSION_ID ?? '').trim() || DEFAULT_EXTENSION_ID;
}

export function itemPath(env) {
  return `publishers/${encodeURIComponent(env.CWS_PUBLISHER_ID.trim())}/items/${encodeURIComponent(extensionIdOf(env))}`;
}

/** 토큰 엔드포인트 오류를 다음에 할 일이 보이는 문장으로. (실측: {"error":"invalid_client","error_description":"…"}) */
export function describeTokenError(status, body) {
  const code = body?.error;
  const detail = body?.error_description ? ` (${body.error_description})` : '';
  const head = `액세스 토큰을 받지 못했습니다 — HTTP ${status}${code ? ` ${code}` : ''}${detail}.`;
  const hint = {
    invalid_client:
      'OAuth 클라이언트를 찾을 수 없거나 시크릿이 틀렸습니다. CWS_CLIENT_ID · CWS_CLIENT_SECRET 이 Google Cloud 콘솔 › 사용자 인증 정보의 OAuth 클라이언트와 같은지 확인하세요.',
    invalid_grant:
      'refresh token 이 만료됐거나 취소됐습니다. OAuth 동의 화면이 「테스트」 상태면 7일 뒤 만료됩니다 — `node scripts/cws-auth.mjs` 로 다시 받으세요(동의 화면을 「프로덕션」으로 바꾸면 이 만료가 없어집니다).',
    invalid_request: '요청에 필요한 값이 비어 있습니다. CWS_CLIENT_ID · CWS_CLIENT_SECRET · CWS_REFRESH_TOKEN 이 모두 채워졌는지 확인하세요.',
    unauthorized_client:
      '이 클라이언트로는 refresh token 을 쓸 수 없습니다. refresh token 을 받을 때 쓴 OAuth 클라이언트와 같은 ID · 시크릿인지 확인하세요.',
    invalid_scope: `스코프가 거부됐습니다. ${SCOPE} 로 refresh token 을 다시 받으세요(node scripts/cws-auth.mjs).`,
  }[code];
  return hint ? `${head}\n→ ${hint}` : head;
}

/** Chrome Web Store API 오류를 문장으로. (실측: {"error":{"code":401,"message":"…","status":"UNAUTHENTICATED"}}) */
export function describeApiError(step, status, body) {
  const err = body?.error ?? {};
  const msg = err.message ? ` — ${err.message}` : '';
  const head = `${step} 실패 — HTTP ${status}${err.status ? ` ${err.status}` : ''}${msg}`;
  const raw = JSON.stringify(err.details ?? '');
  let hint;
  if (status === 401) {
    hint = '액세스 토큰이 거부됐습니다. refresh token 을 받은 Google 계정·스코프를 확인하세요(node scripts/cws-auth.mjs 로 다시 받기).';
  } else if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(`${err.message} ${raw}`)) {
    hint = 'Google Cloud 프로젝트에서 Chrome Web Store API 가 꺼져 있습니다. 콘솔 › API 및 서비스에서 사용 설정하고 몇 분 뒤 다시 실행하세요.';
  } else if (status === 403) {
    hint = '권한이 없습니다. refresh token 을 받은 계정이 CWS_PUBLISHER_ID 퍼블리셔의 멤버인지, CWS_EXTENSION_ID 가 그 퍼블리셔의 확장인지 확인하세요.';
  } else if (status === 404) {
    hint = '퍼블리셔나 확장을 찾지 못했습니다. CWS_PUBLISHER_ID(개발자 대시보드 › 퍼블리셔 › 설정)와 CWS_EXTENSION_ID 를 확인하세요.';
  } else if (status === 400 && /version/i.test(err.message ?? '')) {
    hint = 'manifest.json 의 version 을 스토어에 올라간 것보다 올린 뒤 scripts/build-cws.sh 로 zip 을 다시 만드세요.';
  } else if (status === 429) {
    hint = 'API 호출 한도를 넘었습니다. 잠시 뒤 다시 실행하세요.';
  } else if (status >= 500) {
    hint = '스토어 쪽 일시 오류입니다. 잠시 뒤 다시 실행하세요.';
  }
  return hint ? `${head}\n→ ${hint}` : head;
}

/** zip 안의 manifest.json 을 읽는다 (macOS·리눅스 기본 unzip). */
export function zipManifest(zipPath) {
  try {
    return JSON.parse(execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' }));
  } catch {
    throw new CwsError(`zip 에서 manifest.json 을 읽지 못했습니다: ${zipPath}`);
  }
}

function defaultZip(root) {
  const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
  return { version, zip: join(root, 'dist', `artifact-dock-${version}.zip`) };
}

/** 올리기 전에 zip 이 이번 버전의 웹스토어용인지 확인한다 — 틀린 zip 을 올리면 심사까지 가서야 안다. */
export function checkZip(root, zipArg) {
  const { version, zip: fallback } = defaultZip(root);
  const zip = zipArg ? resolve(zipArg) : fallback;
  const shown = relative(root, zip).startsWith('..') ? zip : relative(root, zip);
  if (!existsSync(zip)) {
    throw new CwsError(`zip 이 없습니다: ${shown}\n→ 먼저 scripts/build-cws.sh 로 만드세요.`);
  }
  const m = zipManifest(zip);
  if ('key' in m) throw new CwsError(`zip 의 manifest 에 "key" 가 남아 있습니다 — 웹스토어가 거부합니다. scripts/build-cws.sh 로 만든 zip 을 쓰세요.`);
  if (m.version !== version) {
    throw new CwsError(`zip 의 버전(${m.version})이 manifest.json(${version})과 다릅니다. scripts/build-cws.sh 로 다시 만드세요.`);
  }
  return { zip, shown, version };
}

/** fetch 한 번. 네트워크 오류도 문장으로 바꾼다. */
async function call(fetchImpl, url, init, step) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new CwsError(`${step} 실패 — 네트워크 오류: ${e?.cause?.code || e?.message || e}`);
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text.slice(0, 200) } };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function getAccessToken(fetchImpl, env) {
  const form = new URLSearchParams({
    client_id: env.CWS_CLIENT_ID.trim(),
    client_secret: env.CWS_CLIENT_SECRET.trim(),
    refresh_token: env.CWS_REFRESH_TOKEN.trim(),
    grant_type: 'refresh_token',
  });
  const r = await call(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }, '토큰 발급');
  if (!r.ok || !r.body?.access_token) throw new CwsError(describeTokenError(r.status, r.body));
  return r.body.access_token;
}

async function fetchStatus(fetchImpl, token, path) {
  const r = await call(fetchImpl, `${API_BASE}/v2/${path}:fetchStatus`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  }, '상태 조회');
  if (!r.ok) throw new CwsError(describeApiError('상태 조회', r.status, r.body));
  return r.body;
}

function describeRevision(label, rev) {
  if (!rev?.state) return `${label}: 없음`;
  const versions = (rev.distributionChannels ?? []).map((c) =>
    c.deployPercentage != null && c.deployPercentage !== 100 ? `${c.crxVersion} (${c.deployPercentage}%)` : c.crxVersion);
  return `${label}: ${rev.state} · ${ITEM_STATE_KO[rev.state] ?? '알 수 없는 상태'}${versions.length ? ` · v${versions.join(', v')}` : ''}`;
}

export function describeStatus(s) {
  const lines = [
    describeRevision('제출본', s.submittedItemRevisionStatus),
    describeRevision('게시본', s.publishedItemRevisionStatus),
  ];
  if (s.lastAsyncUploadState) lines.push(`마지막 업로드: ${s.lastAsyncUploadState}`);
  if (s.takenDown) lines.push('⚠ 스토어에서 내려간 상태입니다(takenDown).');
  if (s.warned) lines.push('⚠ 정책 경고가 있습니다(warned) — 개발자 대시보드를 확인하세요.');
  return lines;
}

async function waitForUpload(fetchImpl, token, path, sleep, log) {
  for (let i = 0; i < POLL_LIMIT; i++) {
    await sleep(POLL_INTERVAL_MS);
    const s = await fetchStatus(fetchImpl, token, path);
    const state = s.lastAsyncUploadState;
    if (state === 'SUCCEEDED') return;
    if (state === 'FAILED' || state === 'NOT_FOUND') {
      throw new CwsError(`업로드 처리 실패 — ${state}. 개발자 대시보드에서 패키지 오류를 확인하세요.`);
    }
    log(`  … 처리 중 (${i + 1}/${POLL_LIMIT})`);
  }
  throw new CwsError(`업로드가 ${(POLL_INTERVAL_MS * POLL_LIMIT) / 1000}초 안에 끝나지 않았습니다. 잠시 뒤 --status 로 확인하세요.`);
}

export function dryRunLines(opts, env, zipInfo) {
  const ext = extensionIdOf(env);
  const item = `publishers/{CWS_PUBLISHER_ID}/items/${ext}`;
  const missing = missingEnv(env);
  const lines = [
    '[dry-run] 네트워크 요청 없이 순서만 보여 줍니다.',
    `확장 ID: ${ext}${env.CWS_EXTENSION_ID ? '' : ' (기본값)'}`,
    `환경변수: ${missing.length ? `비어 있음 → ${missing.join(', ')}` : '필요한 값 모두 있음(값은 출력하지 않음)'}`,
  ];
  if (!opts.statusOnly) lines.push(`zip: ${zipInfo.error ? `✗ ${zipInfo.error}` : `${zipInfo.shown} (v${zipInfo.version})`}`);
  lines.push('', `1) POST ${TOKEN_URL}  (refresh token → access token)`);
  if (opts.statusOnly) {
    lines.push(`2) GET  ${API_BASE}/v2/${item}:fetchStatus`);
    return lines;
  }
  lines.push(`2) POST ${API_BASE}/upload/v2/${item}:upload  (zip 본문)`);
  lines.push(`   업로드가 IN_PROGRESS 면 GET …:fetchStatus 를 ${POLL_INTERVAL_MS / 1000}초 간격 최대 ${POLL_LIMIT}번`);
  if (opts.publish) {
    lines.push(`3) POST ${API_BASE}/v2/${item}:publish${opts.staged ? '  {"publishType":"STAGED_PUBLISH"}' : '  (본문 없음 = 승인 즉시 게시)'}`);
    lines.push(`4) GET  ${API_BASE}/v2/${item}:fetchStatus  (심사 상태 출력)`);
  } else {
    lines.push('3) --no-publish: 제출하지 않음');
  }
  return lines;
}

export async function run({ argv = [], env = process.env, fetch: fetchImpl = globalThis.fetch, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), root = ROOT } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log(HELP);
    return 0;
  }

  if (opts.dryRun) {
    let zipInfo = {};
    if (!opts.statusOnly) {
      try {
        zipInfo = checkZip(root, opts.zip);
      } catch (e) {
        zipInfo = { error: e.message.split('\n')[0] };
      }
    }
    dryRunLines(opts, env, zipInfo).forEach((l) => log(l));
    return 0;
  }

  const missing = missingEnv(env);
  if (missing.length) {
    throw new CwsError(`환경변수가 비어 있습니다: ${missing.join(', ')}\n→ README 「Chrome 웹스토어에 올리기」의 한 번 설정을 따르세요.`);
  }
  const zipInfo = opts.statusOnly ? null : checkZip(root, opts.zip);
  const path = itemPath(env);
  const ext = extensionIdOf(env);

  const token = await getAccessToken(fetchImpl, env);
  log('✓ 액세스 토큰 발급');

  if (opts.statusOnly) {
    describeStatus(await fetchStatus(fetchImpl, token, path)).forEach((l) => log(l));
    return 0;
  }

  log(`… 업로드: ${zipInfo.shown} → ${ext}`);
  const up = await call(fetchImpl, `${API_BASE}/upload/v2/${path}:upload`, {
    method: 'POST',
    // 공식 예시(curl -T)처럼 zip 바이트만 보낸다. Content-Type 을 따로 붙이지 않는다.
    headers: { Authorization: `Bearer ${token}` },
    body: readFileSync(zipInfo.zip),
  }, '업로드');
  if (!up.ok) throw new CwsError(describeApiError('업로드', up.status, up.body));
  const state = up.body?.uploadState;
  if (UPLOAD_PENDING.has(state)) {
    log('  업로드 처리 중 — 끝날 때까지 상태를 확인합니다');
    await waitForUpload(fetchImpl, token, path, sleep, log);
  } else if (state !== 'SUCCEEDED') {
    throw new CwsError(`업로드 실패 — uploadState=${state ?? '(없음)'}${up.body?.error?.message ? `: ${up.body.error.message}` : ''}`);
  }
  const uploaded = up.body?.crxVersion;
  if (uploaded && uploaded !== zipInfo.version) log(`⚠ 스토어가 읽은 버전(${uploaded})이 zip(${zipInfo.version})과 다릅니다.`);
  log(`✓ 업로드 완료 (v${uploaded || zipInfo.version})`);

  if (!opts.publish) {
    log('--no-publish: 심사에 제출하지 않았습니다. 개발자 대시보드나 이 스크립트(옵션 없이)로 제출하세요.');
    return 0;
  }

  const pub = await call(fetchImpl, `${API_BASE}/v2/${path}:publish`, {
    method: 'POST',
    ...(opts.staged
      ? { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: 'STAGED_PUBLISH' }) }
      : { headers: { Authorization: `Bearer ${token}` } }),
  }, '심사 제출');
  if (!pub.ok) throw new CwsError(describeApiError('심사 제출', pub.status, pub.body));
  log(`✓ 심사 제출 — ${pub.body?.state ?? '(상태 없음)'} · ${ITEM_STATE_KO[pub.body?.state] ?? ''}`.trimEnd());
  for (const w of pub.body?.warningInfo?.warnings ?? []) log(`  경고: ${w.reason ?? ''} ${w.description ?? ''}`.trimEnd());

  describeStatus(await fetchStatus(fetchImpl, token, path)).forEach((l) => log(l));
  return 0;
}

// 직접 실행할 때만 돈다 (테스트는 import 해서 run 을 부른다)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run({ argv: process.argv.slice(2) }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof CwsError ? `✗ ${e.message}` : e);
      process.exit(1);
    },
  );
}
