#!/usr/bin/env python3
"""Dvorakel sync server: keeps typing history and settings in step between browsers.

Standard library only (Python 3.9+). Data lives in one SQLite file.

    DVORAKEL_TOKEN=<secret> python3 dvorakel_sync.py [--port 8787] [--db ~/dvorakel-sync.sqlite3]

The token can also come from --token-file. The server binds to 127.0.0.1 by
default: put HTTPS in front of it (e.g. `tailscale serve --bg 8787`), because
the app runs on an https page and browsers block plain-http requests from it.

API (all requests need `Authorization: Bearer <token>`):
  GET  /v1/status                      -> {"sessions": n, "deleted": n, "seq": n}
  POST /v1/push  {"sessions": [...], "deleted": [uid, ...], "settings": {"value": {...}, "updatedAt": ms} | null}
                                       -> {"ok": true, "accepted": n}
  GET  /v1/pull?since=<seq>&limit=<n>  -> {"items": [{"seq", "uid", "deleted", "data"}], "next": seq, "more": bool,
                                           "settings": {"value", "updatedAt"} | null}

Sessions are immutable and identified by `uid`; a pushed session whose uid is
already known (or deleted) is ignored. A deletion replaces the session with a
tombstone so other browsers learn about it on their next pull. Settings are
last-writer-wins by the client's `updatedAt`.
"""
import argparse
import hmac
import json
import os
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MAX_BODY = 64 * 1024 * 1024
MAX_SESSION_BYTES = 2 * 1024 * 1024
MAX_UID = 128
PULL_LIMIT = 1000


class Store:
    def __init__(self, path):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS items (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                deleted INTEGER NOT NULL DEFAULT 0,
                data TEXT
            );
            CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
            """
        )
        self.db.commit()

    def status(self):
        with self.lock:
            live, dead = self.db.execute(
                "SELECT COALESCE(SUM(deleted = 0), 0), COALESCE(SUM(deleted = 1), 0) FROM items"
            ).fetchone()
            seq = self.db.execute("SELECT COALESCE(MAX(seq), 0) FROM items").fetchone()[0]
        return {"sessions": live, "deleted": dead, "seq": seq}

    def push(self, sessions, deleted, settings):
        accepted = 0
        with self.lock, self.db:
            for s in sessions:
                uid = s["uid"]
                cur = self.db.execute(
                    "INSERT OR IGNORE INTO items (uid, deleted, data) VALUES (?, 0, ?)",
                    (uid, json.dumps(s, separators=(",", ":"), ensure_ascii=False)),
                )
                accepted += cur.rowcount
            for uid in deleted:
                row = self.db.execute("SELECT deleted FROM items WHERE uid = ?", (uid,)).fetchone()
                if row and row[0] == 1:
                    continue
                # Re-insert so the tombstone gets a new seq and reaches every browser.
                self.db.execute("DELETE FROM items WHERE uid = ?", (uid,))
                self.db.execute("INSERT INTO items (uid, deleted, data) VALUES (?, 1, NULL)", (uid,))
            if settings is not None:
                cur = self.get_settings_locked()
                if cur is None or settings["updatedAt"] > cur["updatedAt"]:
                    self.db.execute(
                        "INSERT OR REPLACE INTO kv (k, v) VALUES ('settings', ?)",
                        (json.dumps(settings, ensure_ascii=False),),
                    )
        return accepted

    def get_settings_locked(self):
        row = self.db.execute("SELECT v FROM kv WHERE k = 'settings'").fetchone()
        return json.loads(row[0]) if row else None

    def pull(self, since, limit):
        with self.lock:
            rows = self.db.execute(
                "SELECT seq, uid, deleted, data FROM items WHERE seq > ? ORDER BY seq LIMIT ?",
                (since, limit + 1),
            ).fetchall()
            settings = self.get_settings_locked()
        more = len(rows) > limit
        rows = rows[:limit]
        items = [
            {"seq": seq, "uid": uid, "deleted": bool(d), "data": json.loads(data) if data else None}
            for seq, uid, d, data in rows
        ]
        return {"items": items, "next": rows[-1][0] if rows else since, "more": more, "settings": settings}


def valid_uid(u):
    return isinstance(u, str) and 0 < len(u) <= MAX_UID


def parse_push(body):
    if not isinstance(body, dict):
        raise ValueError("body must be an object")
    sessions = body.get("sessions") or []
    deleted = body.get("deleted") or []
    settings = body.get("settings")
    if not isinstance(sessions, list) or not isinstance(deleted, list):
        raise ValueError("sessions and deleted must be lists")
    for s in sessions:
        if not isinstance(s, dict) or not valid_uid(s.get("uid")) or not isinstance(s.get("startedAt"), (int, float)):
            raise ValueError("every session needs a uid and startedAt")
        if len(json.dumps(s)) > MAX_SESSION_BYTES:
            raise ValueError("session too large")
    if not all(valid_uid(u) for u in deleted):
        raise ValueError("deleted must be a list of uids")
    if settings is not None:
        if (
            not isinstance(settings, dict)
            or not isinstance(settings.get("value"), dict)
            or not isinstance(settings.get("updatedAt"), (int, float))
        ):
            raise ValueError("settings must be {value, updatedAt}")
        settings = {"value": settings["value"], "updatedAt": settings["updatedAt"]}
    return sessions, deleted, settings


def make_handler(store, token, origin):
    class Handler(BaseHTTPRequestHandler):
        server_version = "dvorakel-sync/1"

        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s\n" % (self.command, fmt % args))

        def cors(self):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Vary", "Origin")

        def reply(self, code, obj):
            body = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def authed(self):
            got = self.headers.get("Authorization", "")
            ok = got.startswith("Bearer ") and hmac.compare_digest(got[7:].encode(), token.encode())
            if not ok:
                self.reply(401, {"error": "wrong or missing token"})
            return ok

        def do_OPTIONS(self):
            self.send_response(204)
            self.cors()
            # Chrome's private-network preflight (public site -> private address).
            if self.headers.get("Access-Control-Request-Private-Network"):
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            url = urlparse(self.path)
            if url.path == "/health":
                return self.reply(200, {"ok": True})
            if not self.authed():
                return
            if url.path == "/v1/status":
                return self.reply(200, store.status())
            if url.path == "/v1/pull":
                q = parse_qs(url.query)
                try:
                    since = int(q.get("since", ["0"])[0])
                    limit = max(1, min(PULL_LIMIT, int(q.get("limit", ["500"])[0])))
                except ValueError:
                    return self.reply(400, {"error": "since/limit must be integers"})
                return self.reply(200, store.pull(since, limit))
            self.reply(404, {"error": "not found"})

        def do_POST(self):
            url = urlparse(self.path)
            if not self.authed():
                return
            if url.path != "/v1/push":
                return self.reply(404, {"error": "not found"})
            try:
                n = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                n = -1
            if n < 0 or n > MAX_BODY:
                return self.reply(413, {"error": "body too large"})
            try:
                sessions, deleted, settings = parse_push(json.loads(self.rfile.read(n) or b"{}"))
            except (ValueError, json.JSONDecodeError) as e:
                return self.reply(400, {"error": str(e)})
            accepted = store.push(sessions, deleted, settings)
            self.reply(200, {"ok": True, "accepted": accepted})

    return Handler


def main():
    ap = argparse.ArgumentParser(description="Dvorakel sync server")
    ap.add_argument("--host", default=os.environ.get("DVORAKEL_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("DVORAKEL_PORT", "8787")))
    ap.add_argument("--db", default=os.environ.get("DVORAKEL_DB", os.path.expanduser("~/dvorakel-sync.sqlite3")))
    ap.add_argument("--token-file", default=os.environ.get("DVORAKEL_TOKEN_FILE"))
    ap.add_argument(
        "--origin",
        default=os.environ.get("DVORAKEL_ORIGIN", "*"),
        help="allowed browser origin, e.g. https://you.github.io (default: any; the token is the protection)",
    )
    args = ap.parse_args()
    token = os.environ.get("DVORAKEL_TOKEN", "")
    if args.token_file:
        with open(args.token_file, encoding="utf-8") as f:
            token = f.read().strip()
    if len(token) < 16:
        sys.exit("Set a token of at least 16 characters via DVORAKEL_TOKEN or --token-file.")
    store = Store(args.db)
    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(store, token, args.origin))
    print(f"dvorakel-sync on http://{args.host}:{args.port}, data in {args.db}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
