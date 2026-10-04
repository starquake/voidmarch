# Deployments

Voidmarch runs in three environments on one VPS, `zoot` (Debian 13, Docker
29.8, Compose v5.6), behind the SWAG reverse proxy that also serves topbanana
and mediumrogue. `.github/workflows/deploy.yml`
deploys; this file is the one-time setup on the server and on GitHub that the
workflow can't do, and the jobs done by hand afterwards.

| Environment | Address                                       | Deployed when                     | Image                       |
| ----------- | --------------------------------------------- | --------------------------------- | --------------------------- |
| production  | `https://voidmarch.bananajuice.net`             | CI passes on a `v*.*.*` tag       | the release, e.g. `:0.1.0`  |
| staging     | `https://voidmarch-staging.bananajuice.net`     | CI passes on `main`               | `:edge`                     |
| development | `https://voidmarch-development.bananajuice.net` | a PR carries the `deploy:dev` label | `:pr-<n>`, built from the PR |

Staging and production deploy only an image that `ci.yml` signed on `main`
(cosign, checked in `.github/scripts/verify-image.sh`). A release tag doesn't
rebuild: CI's `promote` job gives the image main built for that commit the
version's tags. Development builds the PR's own image, unsigned.

Each environment deploys as its own user, `voidmarch-<env>`, like topbanana's
and mediumrogue's. Every deploy copies `deployments/app/docker-compose.<env>.yml`
to `/home/voidmarch-<env>/voidmarch-<env>/docker-compose.yml`, writes `.env` there with
the image digest, pulls and runs `docker compose up -d`
(`.github/scripts/deploy-remote.sh`), then waits for `/healthz` to answer.

## One-time setup

### 0. Deploy users

One user per environment, in the `docker` group, which the deploy's
`docker compose` needs. As root on the server:

```bash
for env in production staging development; do
  useradd --create-home --shell /bin/bash --groups docker "voidmarch-$env"
done
```

A key pair per environment, made on your own machine; the private half becomes
that environment's `SSH_KEY` secret (step 3), and nothing else uses it:

```bash
for env in production staging development; do
  ssh-keygen -t ed25519 -N '' -C "voidmarch-$env deploy" -f "voidmarch-$env"
done
```

The public half goes in the user's `authorized_keys`, as root on the server,
once per environment:

```bash
env=production   # then staging, then development
install -d -m 700 -o "voidmarch-$env" -g "voidmarch-$env" "/home/voidmarch-$env/.ssh"
cat >> "/home/voidmarch-$env/.ssh/authorized_keys"   # paste voidmarch-$env.pub, then Ctrl-D
chown "voidmarch-$env:" "/home/voidmarch-$env/.ssh/authorized_keys"
chmod 600 "/home/voidmarch-$env/.ssh/authorized_keys"
```

Check it from your machine:

```bash
ssh -i voidmarch-production voidmarch-production@<SSH_HOST> docker ps --format '{{.Names}}'
```

### 1. DNS

Three CNAMEs in `bananajuice.net`, pointing at the VPS like mediumrogue's:
`voidmarch`, `voidmarch-staging` and `voidmarch-development`. Wait until all
three resolve before step 2:

```bash
dig +short voidmarch.bananajuice.net voidmarch-staging.bananajuice.net voidmarch-development.bananajuice.net
```

### 2. TLS and proxy (SWAG)

SWAG's own domain is `URL=linuxeverywhere.link`; the bananajuice.net names are
in `EXTRA_DOMAINS`. Append the three there:

```
EXTRA_DOMAINS=...,mediumrogue-development.bananajuice.net,voidmarch.bananajuice.net,voidmarch-staging.bananajuice.net,voidmarch-development.bananajuice.net
```

SWAG validates over HTTP (`VALIDATION=http`) and asks for one certificate
covering every name, so a single name that doesn't resolve yet fails the whole
request: that is why DNS comes first. An environment variable only changes
when the container is recreated, not restarted.

Copy `deployments/swag/voidmarch*.subdomain.conf` into SWAG's
`proxy-confs/` and reload it:

```bash
docker exec swag nginx -s reload
docker logs --tail 50 swag
```

The confs need nothing special for the game's WebSocket at `/ws`: SWAG's
`proxy.conf` already sets `Upgrade $http_upgrade` and
`Connection $connection_upgrade`, with 240 s read and send timeouts, and the
server sends snapshots 20 times a second, so the connection is never idle that
long.

### 3. GitHub environments

Create `production`, `staging` and `development` under Settings, Environments.
On each:

- Secrets:
  - `SSH_HOST`: the VPS, the same on all three.
  - `SSH_USER`: `voidmarch-<env>`, the environment's own user (step 0).
  - `SSH_KEY`: the private key made for that user.
- Variables:
  - `SERVER_URL`: the environment's address from the table above. The deploy
    checks `SERVER_URL/healthz`.
  - `TRUSTED_PROXY_IPS`: `172.19.0.0/16`, the subnet of the `web` network,
    which SWAG's requests come from. Without it every player has SWAG's
    address, and `REGISTER_LIMIT` (20 names a minute per address) counts them
    all together. If the network is ever recreated, check it again:

    ```bash
    docker network inspect web --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
    ```

### 4. The image on GHCR

CI publishes `ghcr.io/starquake/voidmarch` from `main`. The server logs in with
the workflow's own token for each deploy, so the package needs no other access
as long as it belongs to this repository.

### 5. The `deploy:dev` label

Create a `deploy:dev` label. Adding it to a pull request deploys that PR to
development, and every push to the PR while it carries the label deploys again.
The workflow runs from the PR branch's own copy of `deploy.yml`, so a branch
older than the deploy pipeline has to be rebased first. Development is one slot:
the last PR deployed is the one running.

## By hand

The commands below run as the environment's user, whose home holds its
compose project, e.g. `sudo -iu voidmarch-production`.

### Redeploy

Actions, Deploy, Run workflow, then pick `staging` (main's current `:edge`) or
`production` (the newest release, `:latest`). Development is deployed by the
label only.

### Logs

```bash
cd ~/voidmarch-production && docker compose logs -f --tail 100
```

### A new season

`-new-season` resets the world in the database and needs the server stopped:

```bash
cd ~/voidmarch-production
docker compose stop
docker compose run --rm voidmarch-production -new-season
docker compose up -d
```

### Backup

Each environment keeps its database on its own volume,
`voidmarch-<env>_voidmarch_<env>_data` (the compose project is the directory's
name). Stop the server so the SQLite file and its WAL are consistent, copy, and
start it again:

```bash
cd ~/voidmarch-production
docker compose stop
docker run --rm -v voidmarch-production_voidmarch_production_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/voidmarch-$(date +%F).tar.gz -C /data .
docker compose up -d
```

### Wiping development

```bash
cd ~/voidmarch-development && docker compose down -v
```

The next labeled deploy starts it with a fresh database.
