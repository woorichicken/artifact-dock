#!/usr/bin/env node
// Chrome 웹스토어 업로드용 refresh token 을 처음 한 번 받는다. 의존성 없음.
//
//   set -a; . ~/.config/artifact-dock/cws.env; set +a     # CWS_CLIENT_ID · CWS_CLIENT_SECRET 이 든 파일
//   node scripts/cws-auth.mjs
//
// 흐름 (Google OAuth 설치형 앱 — https://developers.google.com/identity/protocols/oauth2/native-app)
//   1) 127.0.0.1 의 빈 포트에 잠깐 서버를 띄운다 (루프백 리다이렉트 — 「데스크톱 앱」 OAuth 클라이언트가 허용)
//   2) 출력한 주소를 브라우저에서 열어 로그인·동의 → Google 이 그 포트로 code 를 돌려준다
//   3) code + PKCE verifier 를 토큰 엔드포인트에서 refresh token 으로 바꾼다
//   4) refresh token 을 화면에 찍지 않고 권한 600 파일에 저장한다 (저장소 안에는 쓰지 않는다)

import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOKEN_URL, SCOPE, CwsError, describeTokenError } from './publish-cws.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const DEFAULT_OUT = join(homedir(), '.config', 'artifact-dock', 'cws.env');
const DEFAULT_TIMEOUT_S = 300;

const HELP = `사용: node scripts/cws-auth.mjs [--out <파일>] [--timeout <초>]

  CWS_CLIENT_ID · CWS_CLIENT_SECRET (「데스크톱 앱」 OAuth 클라이언트)을 환경변수로 받아
  브라우저 로그인 후 refresh token 을 <파일>(기본 ${DEFAULT_OUT.replace(homedir(), '~')})에 저장한다.
  토큰 값은 화면에 출력하지 않는다.`;

export function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, timeoutS: DEFAULT_TIMEOUT_S, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--timeout') opts.timeoutS = Number(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else throw new CwsError(`모르는 옵션: ${a}\n\n${HELP}`);
  }
  if (!opts.out) throw new CwsError('--out 뒤에 파일 경로가 필요합니다.');
  if (!(opts.timeoutS > 0)) throw new CwsError('--timeout 은 양수(초)여야 합니다.');
  return opts;
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE: verifier 는 43~128자, challenge = base64url(SHA-256(verifier)) */
export function pkcePair() {
  const verifier = b64url(randomBytes(48)); // 64자
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function authUrl({ clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    // refresh token 을 받으려면 offline, 예전에 동의한 계정에서도 새로 발급받으려면 consent
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** 루프백으로 돌아온 주소에서 code 를 꺼낸다. state 가 다르면 다른 요청이 끼어든 것이라 거부한다. */
export function parseCallback(url, expectedState) {
  const u = new URL(url, 'http://127.0.0.1');
  const error = u.searchParams.get('error');
  if (error) {
    const why = error === 'access_denied' ? '동의 화면에서 거부했거나, 이 계정이 OAuth 동의 화면의 테스트 사용자가 아닙니다.' : '';
    throw new CwsError(`Google 이 승인을 돌려주지 않았습니다 — ${error}.${why ? `\n→ ${why}` : ''}`);
  }
  if (u.searchParams.get('state') !== expectedState) throw new CwsError('state 가 맞지 않습니다 — 다른 요청이 끼어들었을 수 있어 중단합니다. 다시 실행하세요.');
  const code = u.searchParams.get('code');
  if (!code) throw new CwsError('돌아온 주소에 code 가 없습니다. 다시 실행하세요.');
  return code;
}

export async function exchangeCode(fetchImpl, { clientId, clientSecret, code, verifier, redirectUri }) {
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
  } catch (e) {
    throw new CwsError(`토큰 교환 실패 — 네트워크 오류: ${e?.cause?.code || e?.message || e}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new CwsError(describeTokenError(res.status, body));
  if (!body.refresh_token) {
    throw new CwsError('응답에 refresh token 이 없습니다. 이 계정의 기존 승인을 https://myaccount.google.com/permissions 에서 지우고 다시 실행하세요.');
  }
  return body.refresh_token;
}

/**
 * KEY='value' 줄을 넣거나 바꾼다. 다른 줄(CWS_PUBLISHER_ID 등)은 그대로 둔다.
 * 저장소 안 경로는 거부한다 — 실수로 커밋되면 토큰이 공개 저장소에 올라간다.
 */
export function checkOutPath(path, repoRoot = ROOT) {
  const target = resolve(path);
  const root = resolve(repoRoot);
  if (target === root || target.startsWith(root + sep)) {
    throw new CwsError(`저장소 안(${target})에는 자격증명을 쓰지 않습니다. --out 으로 저장소 밖 경로를 주세요.`);
  }
  return target;
}

export function writeEnvFile(path, entries, repoRoot = ROOT) {
  const target = checkOutPath(path, repoRoot);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const lines = existsSync(target) ? readFileSync(target, 'utf8').split('\n') : [];
  for (const [key, value] of Object.entries(entries)) {
    if (/['\n]/.test(value)) throw new CwsError(`${key} 값에 쓸 수 없는 문자가 있습니다.`);
    const line = `${key}='${value}'`;
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = line;
    else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, line);
  }
  const text = lines.join('\n').replace(/\n*$/, '\n');
  writeFileSync(target, text, { mode: 0o600 });
  chmodSync(target, 0o600); // 이미 있던 파일이면 writeFileSync 의 mode 가 적용되지 않는다
  return target;
}

/** 루프백 서버를 띄우고 code 하나를 받을 때까지 기다린다. */
function listenOnce(state, timeoutMs) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const done = new Promise((res, rej) => (settle = { res, rej }));
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith('/?') && req.url !== '/') {
        res.writeHead(404).end(); // favicon 등
        return;
      }
      try {
        const code = parseCallback(req.url, state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<!doctype html><meta charset="utf-8"><title>Artifact Dock</title><p>승인을 받았습니다. 이 탭을 닫고 터미널로 돌아가세요.</p>');
        settle.res(code);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(`<!doctype html><meta charset="utf-8"><title>Artifact Dock</title><p>${String(e.message).replace(/[<&]/g, '')}</p>`);
        settle.rej(e);
      }
    });
    const timer = setTimeout(() => settle.rej(new CwsError(`${timeoutMs / 1000}초 안에 브라우저 승인이 오지 않았습니다. 다시 실행하세요.`)), timeoutMs);
    done.finally(() => {
      clearTimeout(timer);
      server.close();
    }).catch(() => {});
    server.on('error', (e) => rejectStart(new CwsError(`루프백 서버를 띄우지 못했습니다: ${e.message}`)));
    // 127.0.0.1 의 빈 포트. 외부에서 접근할 수 없는 주소만 연다.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveStart({ redirectUri: `http://127.0.0.1:${port}`, code: done });
    });
  });
}

export async function run({ argv = [], env = process.env, fetch: fetchImpl = globalThis.fetch, log = console.log, repoRoot = ROOT } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log(HELP);
    return 0;
  }
  const clientId = String(env.CWS_CLIENT_ID ?? '').trim();
  const clientSecret = String(env.CWS_CLIENT_SECRET ?? '').trim();
  const missing = [!clientId && 'CWS_CLIENT_ID', !clientSecret && 'CWS_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) {
    throw new CwsError(`환경변수가 비어 있습니다: ${missing.join(', ')}\n→ Google Cloud 콘솔에서 「데스크톱 앱」 OAuth 클라이언트를 만들고 그 ID·시크릿을 넣으세요.`);
  }
  // 저장 위치가 막혀 있으면 브라우저 로그인 전에 알린다
  checkOutPath(opts.out, repoRoot);

  const state = b64url(randomBytes(16));
  const { verifier, challenge } = pkcePair();
  const { redirectUri, code: codePromise } = await listenOnce(state, opts.timeoutS * 1000);
  log('아래 주소를 브라우저에서 열고, 퍼블리셔 계정으로 로그인해 승인하세요:');
  log('');
  log(authUrl({ clientId, redirectUri, challenge, state }));
  log('');
  log(`(${redirectUri} 에서 기다리는 중 — 최대 ${opts.timeoutS}초)`);

  const code = await codePromise;
  const refreshToken = await exchangeCode(fetchImpl, { clientId, clientSecret, code, verifier, redirectUri });
  const saved = writeEnvFile(opts.out, { CWS_CLIENT_ID: clientId, CWS_CLIENT_SECRET: clientSecret, CWS_REFRESH_TOKEN: refreshToken }, repoRoot);
  log(`✓ refresh token 을 저장했습니다: ${saved.replace(homedir(), '~')} (권한 600, 값은 출력하지 않음)`);
  log('  CWS_PUBLISHER_ID 가 아직 없으면 이 파일에 추가하세요(개발자 대시보드 › 퍼블리셔 › 설정).');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run({ argv: process.argv.slice(2) }).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof CwsError ? `✗ ${e.message}` : e);
      process.exit(1);
    },
  );
}
