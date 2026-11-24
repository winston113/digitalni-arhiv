# Installing on Unraid

[Slovenščina](unraid.md)

Two separate instances: your private archive and, if needed, the public demo. The examples assume a pool named `cache`; change the path if yours has another name.

**Keep the data on the pool path (`/mnt/cache/...`), not on `/mnt/user/...`.** The database is SQLite, and users report corrupted databases on Unraid's merged `/mnt/user` view. The `appdata` share must stay on the pool (Array as secondary storage: none).

## 1. Prepare

Install **Compose Manager Plus** from the Apps tab; it adds the `docker compose` command. Then, in the Unraid terminal:

```sh
mkdir -p /mnt/cache/appdata/digitalni-arhiv/data /mnt/cache/appdata/digitalni-arhiv/data-demo
chown -R 99:100 /mnt/cache/appdata/digitalni-arhiv/data /mnt/cache/appdata/digitalni-arhiv/data-demo
cd /mnt/cache/appdata/digitalni-arhiv
```

Copy `docker-compose.yaml`, `docker-compose.demo.yaml`, `.env.example` (as `.env`) and `.env.demo.example` (as `.env.demo`) into this folder.

## 2. Get the image

While the package is private, the simplest way is to send the image from the machine where you built it:

```sh
podman save ghcr.io/winston113/digitalni-arhiv:1.2.0 | ssh root@UNRAID docker load
```

Compose uses a local image and does not try to download it again. If the package is public, skip this step.

## 3. Private archive

In `.env`:

```
BASE_URL=https://archive.example.com
BIND=UNRAID-IP:3000
TRUST_PROXY=true
DATA=/mnt/cache/appdata/digitalni-arhiv/data
PUID=99
PGID=100
```

```sh
docker compose up -d --no-build
docker compose logs
```

In Caddy:

```
archive.example.com {
    reverse_proxy UNRAID-IP:3000
}
```

Register, which makes you the administrator. Then set `REGISTRATION=false` and run `docker compose up -d --no-build` again. Finally set up email and confirm your address under My account.

With `TRUST_PROXY=true`, only Caddy should be able to reach port 3000.

## 4. Public demo

In `.env.demo`:

```
DEMO_BASE_URL=https://archive-demo.example.com
DEMO_BIND=UNRAID-IP:3100
DEMO_DATA=/mnt/cache/appdata/digitalni-arhiv/data-demo
DEMO_PUID=99
DEMO_PGID=100
```

```sh
docker compose -f docker-compose.demo.yaml --env-file .env.demo up -d --no-build
```

First open it only to your own network, so that you create the administrator:

```
archive-demo.example.com {
    @outside not remote_ip private_ranges
    respond @outside 403
    reverse_proxy UNRAID-IP:3100
}
```

1. Register the administrator.
2. Under Admin, create the test account and turn off "must change the password at next sign-in".
3. Add the sample contracts:
   `docker compose -f docker-compose.demo.yaml --env-file .env.demo exec arhiv node dist/server/cli.js demo test@example.com`
4. Remove the two `@outside` lines and reload Caddy.

If someone else registered first, make yourself an administrator with `... exec arhiv node dist/server/cli.js skrbnik you@example.com` and delete the other account.

### Keep the demo away from your network

The demo needs no outgoing connections unless you use email or OpenID Connect on it. Block them, so that it cannot reach your home network even if it were compromised:

```sh
iptables -I DOCKER-USER -i br-arhivdemo -m conntrack --ctstate NEW -j DROP
iptables -I INPUT -i br-arhivdemo -m conntrack --ctstate NEW -j DROP
```

The rules are lost on reboot. To keep them, add the same lines to `/boot/config/go` after a check that Docker has started, or run them with the User Scripts plugin when the array starts.

After grading: `docker compose -f docker-compose.demo.yaml --env-file .env.demo down`, then remove the Caddy site and the `data-demo` folder.

## 5. Backup

```sh
cd /mnt/cache/appdata/digitalni-arhiv
docker compose stop
tar czf /mnt/user/backups/archive-$(date +%F).tgz -C data .
docker compose start
```

Restore: stop, empty `data`, `tar xzf FILE -C data`, `chown -R 99:100 data`, start.

## 6. Upgrade

Take a backup, change the image version in the Compose file, load or pull the new image, and run `docker compose up -d --no-build`.
