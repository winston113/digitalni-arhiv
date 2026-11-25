# Digital Contract Archive

[Slovenščina](README.md)

A self-hosted web app that keeps a company's contracts in one place and warns you before they expire. Upload a PDF, set its category and deadlines, find it again quickly, and extend or terminate it in time.

The interface is in Slovenian (default) and English. Choose the language in the header, next to the theme.

## Features

- Contracts with PDF upload, preview and download, search and filters
- Annexes and attachments, up to 30 PDFs per contract
- Export of everything as a ZIP with the PDFs and an Excel spreadsheet
- Optional: fill in the form from the PDF with AI (Ollama, OpenAI-compatible or Anthropic), allowed per user by an administrator
- Search inside documents by keyword or regular expression, with OCR for scans
- Action deadlines that take the notice period into account, shown in the app and sent by email
- Light, dark and system theme; works on desktop and phone
- Password sign-in, always available, plus any OpenID Connect provider (Zitadel, Keycloak, Authentik and others)
- Admin area for users, permissions, email and sign-in settings
- Every user sees only their own contracts; administrators cannot see other people's
- One container, one data folder

## Running it

You need Docker with Compose, or Podman.

```sh
git clone https://github.com/winston113/digitalni-arhiv.git
cd digitalni-arhiv
cp .env.example .env      # set BASE_URL and anything else you need
docker compose up -d --build
```

`BASE_URL` must be exactly the address people open in the browser. To try it on your own machine, use `BASE_URL=http://localhost:3000` and `TRUST_PROXY=false`.

**The first account becomes the administrator**, so register before you let others in. You can then set `REGISTRATION=false` and restart.

With Podman, point Compose at its socket:

```sh
systemctl --user enable --now podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
```

### Pulling the image from a private registry

While the GitHub package is private, sign in once on the server with a classic personal access token that has `read:packages`:

```sh
docker login ghcr.io -u <github-user>
docker compose pull
```

On Unraid the login is kept in memory and is lost on reboot. Instead of pulling, you can build from source (`docker compose up -d --build`) or copy the image from another machine:

```sh
docker save ghcr.io/winston113/digitalni-arhiv:1.4.0 | ssh server docker load
```

### Reverse proxy (Caddy)

```
archive.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Set `TRUST_PROXY=true`.

### OpenID Connect

Set it up under Admin, External sign-in. Register the redirect URI shown there (`https://archive.example.com/api/auth/callback/oidc`) with your provider, enter the provider address, client ID and authentication method, check the connection and save. No restart is needed. The `OIDC_*` variables work too and take precedence.

Password sign-in stays available behind "Unable to sign in with …?". People who use the provider can set a fallback password under My account. For safety, a password account and a provider account with the same email are never linked automatically.

### Email

Set it up under Admin, Email (for Mailjet: `in-v3.mailjet.com`, port 587, STARTTLS, API key and secret key). It is used for expiry reminders, password resets and confirming addresses. Reminders go only to confirmed addresses.

### Reading contract details (AI)

When adding or editing a contract, "Fill in from PDF" suggests the title, party, category, number, dates, notice period and value. It is off by default. The file preview, when adding and editing, works without it too; the browser draws it, on phones behind a "Show document" button.

1. Under Admin, Artificial intelligence, choose a provider (Ollama, OpenAI or a compatible server, Anthropic), check the connection and pick a model.
2. On a user's page, turn on "Read details from PDFs with AI". Nobody has it by default, not even the administrator. Reads per user per day are limited.

Suggestions are never saved on their own and never overwrite what the user typed. The party, number, dates, notice period and value appear only if confirmed by a quote that is literally in the document. Title and category are suggested without a quote. Each detail shows its page and quote, and the place is highlighted in the file preview on the right: clicking the quote shows the place, clicking the highlight opens the field. The model can still be wrong, for example by picking the wrong date, so check the details.

Only the text of the contract is sent, not the file. With your own Ollama server the text stays on your network. The key is encrypted and never shown again. For contracts longer than about 25 pages, whole pages from the beginning and end are read, and the app says how many. Connect a model directly rather than an agent with tools (such as Hermes Agent).

### Large files and splitting

Files can be up to 100 MB by default (`MAX_FILE_MB`). A file is written straight to disk, so a large scan needs little memory. Files that were uploaded but not saved are deleted after a day. The reverse proxy has to allow requests that large; Caddy does not limit them by default.

If one PDF holds several contracts or annexes, choose "Split the file" on the New contract page. Mark on the thumbnails where each new document starts and choose whether it is a contract, an annex to one of them, or left out. Every contract then gets its own form, and its annexes are attached when you save it. With the AI permission, "Suggest a split" proposes the starts; the beginning and end of each page's text are sent to the provider.

### Content search and OCR

The text of every PDF is read in the background after upload; scanned pages are recognised with Tesseract (Slovenian and English). Keyword search ignores accents and finds other forms of Slovenian words, quotes mean an exact phrase and a minus excludes a word. Regular expressions run in a separate thread with a time limit.

Pages are recognised in parallel. `OCR_WORKERS=auto` follows the CPU cores and memory available to the container (up to 8); each worker uses about 110 MB. Eight workers are roughly six times faster than one. Tesseract does not use a GPU. Only the neural engine is used; in our tests the default mix with the older engine lost whole lines on poor scans.

Turn OCR off with `OCR=false`; `OCR_LANGUAGES` sets the languages. The `indeks` command reads all documents again.

### Administration commands

```sh
docker compose exec arhiv node dist/server/cli.js geslo user@example.com     # set a new password
docker compose exec arhiv node dist/server/cli.js skrbnik user@example.com   # make administrator
docker compose exec arhiv node dist/server/cli.js indeks                     # read all documents again
docker compose exec arhiv node dist/server/cli.js demo user@example.com      # sample contracts
```

### Backup and restore

A backup holds the database, the PDFs and the secret that encrypts the mail and provider passwords. Keep it somewhere safe.

```sh
docker compose stop
docker run --rm -v arhiv_podatki:/data alpine tar czf - -C /data . > arhiv-backup.tgz
docker compose start
```

Restoring into an empty volume (`docker compose down -v` deletes existing data):

```sh
docker compose create
docker run --rm -i -v arhiv_podatki:/data alpine sh -c 'rm -rf /data/* && tar xzf - -C /data && chown -R 1000:1000 /data' < arhiv-backup.tgz
docker compose start
```

The Compose files are pinned to an exact version. To upgrade, change the image version and run `docker compose up -d`. Take a backup before every upgrade, and try a restore once before you rely on it.

To use a host folder instead of a volume, set `DATA`, `PUID` and `PGID` in `.env`. For Unraid see [docs/unraid.en.md](docs/unraid.en.md).

### Public demo

`docker-compose.demo.yaml` runs a separate instance with its own data and limited resources. See `.env.demo.example`.

## Development

You need Node.js 24.

```sh
npm ci --ignore-scripts
npm run dev:server        # API on port 3000
npm run dev:web           # interface on port 5173
npm test
```

Start the server with `BASE_URL=http://localhost:5173` while developing. Slovenian text is the key for translations; add English in `src/shared/i18n.ts`. Using a text without a translation fails the type check.

## Licence

[MIT](LICENSE). Licences of the libraries used are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The IBM Plex Sans font is licensed under SIL OFL 1.1. The container image also includes the separate programs Poppler (GPL-2.0-or-later) and Tesseract (Apache-2.0) from Alpine.
