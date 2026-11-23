# Digital Contract Archive

[Slovenščina](README.md)

A self-hosted web app that keeps a company's contracts in one place and warns you before they expire. Upload a PDF, set its category and deadlines, find it again quickly, and extend or terminate it in time.

The interface is in Slovenian (default) and English. Choose the language in the header, next to the theme.

## Features

- Contracts with PDF upload, preview and download, search and filters
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

### Administration commands

```sh
docker compose exec arhiv node dist/server/cli.js geslo user@example.com     # set a new password
docker compose exec arhiv node dist/server/cli.js skrbnik user@example.com   # make administrator
docker compose exec arhiv node dist/server/cli.js demo user@example.com      # sample contracts
```

### Backup

Stop the container, copy the whole `podatki` volume, start it again. The copy holds the database, the PDFs and the session secret.

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

[MIT](LICENSE). Licences of the libraries used are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). The IBM Plex Sans font is licensed under SIL OFL 1.1.
