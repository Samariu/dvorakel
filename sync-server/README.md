# Dvorakel sync server

Keeps your typing history and settings the same on several computers (e.g. laptop and desktop). A small server on a
Raspberry Pi stores everything; each browser uploads its new tests and downloads the others'.

- **Nothing is overwritten.** Every test has its own id, so tests from both computers are kept (a merge, not a copy).
  Deleting a test deletes it everywhere. Settings: the most recent change wins.
- **Works offline.** Tests are saved in the browser first and uploaded when the Pi is reachable again.
- One Python file, standard library only, data in one SQLite file. Protected by a secret token.

## Why Tailscale

The app runs on an `https://` page (GitHub Pages). Browsers block such pages from talking to a plain `http://` address,
so the Pi needs an HTTPS address with a real certificate. [Tailscale](https://tailscale.com) (free for personal use)
gives every device in your private network a name, and `tailscale serve` gives the Pi an HTTPS certificate. Bonus:
sync also works when your laptop is not at home.

## Setup (about 10 minutes)

### 1. Tailscale on all three devices

On the Pi:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up
```

Install Tailscale on the laptop and the desktop too (tailscale.com/download) and log in with the same account.

In the Tailscale admin console, open **DNS** and make sure **MagicDNS** and **HTTPS Certificates** are enabled.

### 2. The server on the Pi

Copy `dvorakel_sync.py` to `~/dvorakel-sync/` on the Pi (e.g. with `scp` or by cloning this repository), then create a
token. The token is the password for your data; keep it to yourself.

```bash
mkdir -p ~/dvorakel-sync && cd ~/dvorakel-sync
```

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > token && chmod 600 token && cat token
```

Try it once by hand (stop with Ctrl+C):

```bash
python3 dvorakel_sync.py --db data.sqlite3 --token-file token
```

Then run it as a service, so it starts with the Pi:

```bash
sudo cp dvorakel-sync@.service /etc/systemd/system/
```

```bash
sudo systemctl enable --now dvorakel-sync@$USER
```

The unit expects the files in `/home/<user>/dvorakel-sync/`. Check it with `systemctl status dvorakel-sync@$USER`.

### 3. HTTPS in front of it

```bash
sudo tailscale serve --bg 8787
```

This prints the address, something like `https://raspberrypi.tail1234.ts.net`. The server itself only listens on the
Pi's own localhost; Tailscale forwards to it. (Older Tailscale versions use a different `serve` syntax: see
`tailscale serve --help`.)

Check from the laptop: `https://raspberrypi.tail1234.ts.net/health` in a browser should show `{"ok":true}`.

### 4. Connect each browser

In Dvorakel: **Settings → Sync**, enter the address and the token, press **Connect**. Do this on the laptop and on the
desktop. On connecting, everything already in that browser is uploaded and merged.

Chrome may ask once whether the site may access devices on your local network: allow it. (Whether it asks depends
on the Chrome version and how it classifies Tailscale addresses.)

## When it syncs

On start, after every saved test, after deleting a test, shortly after changing a setting, when you come back to the
tab, when the network comes back, and every 2 minutes while the tab is open. Settings → Sync shows the last sync or
the error.

## Good to know

- **Delete all data** and **Import backup** apply to all synced browsers while sync is on (the app warns you).
- The connection settings (address, token) are per browser and are not part of backups.
- **Backup of the Pi data:** `sqlite3 ~/dvorakel-sync/data.sqlite3 ".backup backup.sqlite3"` (needs the `sqlite3`
  package), or the app's own JSON export.
- To restrict which website may call the server, start it with `--origin https://<you>.github.io`. The default allows
  any origin; the token is what protects the data.

## API

All endpoints except `/health` need `Authorization: Bearer <token>`.

| Request | Body / query | Answer |
| --- | --- | --- |
| `GET /health` | | `{"ok": true}` |
| `GET /v1/status` | | `{"sessions", "deleted", "seq"}` |
| `POST /v1/push` | `{"sessions": [...], "deleted": [uid...], "settings": {"value", "updatedAt"} or null}` | `{"ok", "accepted"}` |
| `GET /v1/pull` | `?since=<seq>&limit=<n>` | `{"items": [{"seq", "uid", "deleted", "data"}], "next", "more", "settings"}` |
