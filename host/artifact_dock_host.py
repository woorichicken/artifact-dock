#!/usr/bin/env python3
"""Artifact Dock 네이티브 메시징 호스트.

왜 있나:
  `open x.html` 은 물론이고 `open -g` 나 AppleScript 로 탭을 만들어도
  Chrome 은 자기 앱을 앞으로 가져온다(실측 확인). 이건 확장 프로그램이 못 막는다.
  유일하게 포커스를 건드리지 않는 경로는 "확장 프로그램이 직접
  chrome.tabs.create({active:false}) 를 부르는 것"이다.

  그래서 이 호스트가 다리를 놓는다:
    CLI (artifact-open) --unix socket--> host --native messaging--> 확장 --> 백그라운드 탭

수명:
  Chrome 이 확장의 connectNative() 로 이 프로세스를 띄우고, 연결이 끊기면 종료된다.
  네이티브 메시징 연결이 살아 있는 동안은 MV3 서비스 워커도 죽지 않는다.
"""

import json
import os
import socket
import struct
import sys
import threading
import queue

# 테스트는 ARTIFACT_DOCK_SOCKET 으로 경로를 바꿔서 돌아가는 확장의 소켓을 건드리지 않는다.
SOCKET_PATH = os.environ.get(
    "ARTIFACT_DOCK_SOCKET",
    os.path.expanduser("~/Library/Application Support/ArtifactDock/dock.sock"),
)

# stdout 은 Chrome 전용 채널이다. 여기에 print 한 글자라도 섞이면 프로토콜이 깨진다.
_stdout = sys.stdout.buffer
_stdout_lock = threading.Lock()

# 확장이 보내올 응답을 요청 id 별로 기다리는 곳
_pending: dict[str, queue.Queue] = {}
_pending_lock = threading.Lock()


def log(msg):
    # 진단용. stderr 는 Chrome 이 확장 로그로 흘려보내므로 안전하다.
    print(f"[artifact-dock-host] {msg}", file=sys.stderr, flush=True)


def send_to_chrome(obj):
    data = json.dumps(obj).encode("utf-8")
    with _stdout_lock:
        _stdout.write(struct.pack("<I", len(data)))
        _stdout.write(data)
        _stdout.flush()


def read_from_chrome():
    """Chrome → host 메시지를 하나 읽는다. 연결이 끊기면 None."""
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    body = sys.stdin.buffer.read(length)
    if len(body) < length:
        return None
    return json.loads(body.decode("utf-8"))


def handle_client(conn):
    """CLI 한 명을 처리한다. 요청 JSON 한 줄 → 응답 JSON 한 줄."""
    conn.settimeout(10)
    try:
        buf = b""
        while b"\n" not in buf:
            chunk = conn.recv(65536)
            if not chunk:
                break
            buf += chunk
        if not buf.strip():
            return

        req = json.loads(buf.decode("utf-8").strip())
        req_id = req.get("id") or os.urandom(6).hex()
        req["id"] = req_id

        box: queue.Queue = queue.Queue(maxsize=1)
        with _pending_lock:
            _pending[req_id] = box

        send_to_chrome(req)

        try:
            reply = box.get(timeout=8)
        except queue.Empty:
            reply = {"ok": False, "error": "확장 프로그램이 응답하지 않습니다"}
        finally:
            with _pending_lock:
                _pending.pop(req_id, None)

        conn.sendall((json.dumps(reply, ensure_ascii=False) + "\n").encode("utf-8"))
    except Exception as e:  # 클라이언트 하나가 죽어도 호스트는 살아 있어야 한다
        log(f"client error: {e}")
        try:
            conn.sendall((json.dumps({"ok": False, "error": str(e)}) + "\n").encode())
        except OSError:
            pass
    finally:
        conn.close()


def serve_socket():
    os.makedirs(os.path.dirname(SOCKET_PATH), exist_ok=True)
    # 이전 프로세스가 남긴 소켓 파일이 있으면 bind 가 실패한다. 지우고 시작.
    try:
        os.unlink(SOCKET_PATH)
    except FileNotFoundError:
        pass

    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(SOCKET_PATH)
    os.chmod(SOCKET_PATH, 0o600)  # 내 계정만 (다른 사용자가 탭을 열 수 있으면 안 된다)
    srv.listen(16)
    log(f"listening on {SOCKET_PATH}")

    while True:
        try:
            conn, _ = srv.accept()
        except OSError:
            break
        threading.Thread(target=handle_client, args=(conn,), daemon=True).start()


def main():
    threading.Thread(target=serve_socket, daemon=True).start()
    send_to_chrome({"type": "host:ready", "socket": SOCKET_PATH})

    # Chrome 이 연결을 끊을 때까지 응답을 받아 넘긴다.
    while True:
        msg = read_from_chrome()
        if msg is None:
            break
        rid = msg.get("id")
        with _pending_lock:
            box = _pending.get(rid)
        if box:
            try:
                box.put_nowait(msg)
            except queue.Full:
                pass

    try:
        os.unlink(SOCKET_PATH)
    except OSError:
        pass
    log("chrome disconnected, exiting")


if __name__ == "__main__":
    main()
