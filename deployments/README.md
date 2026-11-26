# Deployments

Voidmarch runs in three environments on one VPS, `zoot.linuxeverywhere.link`
(Fedora, rootless Podman, Caddy). Each environment is a Linux user of its own,
`voidmarch-<env>`, whose systemd runs the game as a Quadlet unit on
`127.0.0.1:<port>`; Caddy serves the name over HTTPS and proxies it there.
`.github/workflows/deploy.yml` deploys. The server side (the users, their
deploy keys, the ports and Caddy's sites) is set up by Ansible in
[linuxeverywhere-infra](https://github.com/starquake/linuxeverywhere-infra)
(`ansible/roles/voidmarch`, `hosts/zoot/README.md`), not here.

| Environment | Address                                         | User                    | Port | Deployed when                                  | Image                                     |
| ----------- | ----------------------------------------------- | ----------------------- | ---- | ---------------------------------------------- | ----------------------------------------- |
| production  | `https://voidmarch.bananajuice.net`             | `voidmarch-production`  | 8120 | CI passes on a `vX.Y.Z` tag                    | the release, e.g. `:1.0.0`                |
| staging     | `https://voidmarch-staging.bananajuice.net`     | `voidmarch-staging`     | 8121 | CI passes on a `vX.Y.Z-rc.N` tag               | the release candidate, e.g. `:1.0.0-rc.1` |
| development | `https://voidmarch-development.bananajuice.net` | `voidmarch-development` | 8122 | CI passes on `main`; a PR labeled `deploy:dev` | `:edge`; `:pr-<n>`, built from the PR     |

Each environment is one step more stable than the one before (the README's
Versions section). Production, staging and development's `:edge` deploy only
an image that `ci.yml` signed on `main` (cosign, checked in
`.github/scripts/verify-image.sh`). A tag doesn't rebuild: CI's `promote` job
gives the image main built for that commit the version's tags. A labeled PR
builds its own image for development, unsigned. Development's user runs code
nobody reviewed yet, so the server caps its slice (1.5 GB, one CPU, 512 tasks).

## Layout on the server

In each user's home (0700):

| Path                                               | What                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `~/.config/containers/systemd/voidmarch.container` | the Quadlet unit: `deployments/podman/<env>.container` with `Image=` pinned to a digest |
| `~/data/voidmarch/`                                | the database, `voidmarch.db` with its `-wal` and `-shm`, mounted at `/data`             |
| `~/data/preview/`                                  | development only: a `deploy:dev` PR's database                                           |
| `~/.pr`                                            | development only: the PR in the slot, while one is                                       |
| `~/.deploy.lock`                                   | taken by each deploy, so two never change the server at once                             |
| `~/voidmarch-deploy/<id>/`                         | a deploy's upload, removed when it ends                                                  |

The unit (`deployments/podman/production.container` explains each line) runs
the container `voidmarch` as systemd's `voidmarch.service`:

- On `127.0.0.1:<port>` only, through `pasta` with `--host-lo-to-ns-lo`, so the
  server sees Caddy as 127.0.0.1. `TRUSTED_PROXY_IPS=127.0.0.1/32` then makes
  `REGISTER_LIMIT` count the player's address from Caddy's `X-Forwarded-For`.
  Caddy passes the WebSocket at `/ws` through as it is.
- The image's `nonroot` user (65532) is mapped to the environment's user
  (`UserNS=keep-id`), so `~/data/voidmarch` and the database stay owned by
  `voidmarch-<env>` itself, not a subordinate id. The mount has `:Z` (a label
  only this container can use) and `:U` (the files are handed to the
  container's user, which is the environment's user, on every start).
- A read-only root, no capabilities, no new privileges.
- The image's health check, in JSON form (the image has no shell). An
  unhealthy container is killed and `Restart=always` starts it again.
- `WantedBy=default.target`: with lingering on, the user's systemd starts it
  at boot without a login.

Nothing in it is secret, so there is no env file: every setting is in the
unit.

## A deploy, step by step

1. The job resolves the image tag to its digest and, except for a PR's build,
   checks CI's signature on it.
2. `.github/scripts/deploy-ssh.sh` logs in as the environment's user with its
   `SSH_KEY` and sends `deployments/podman/deploy.sh` and the environment's
   unit, from `main`'s checkout, into `~/voidmarch-deploy/<id>`. The deploy
   keys are in `authorized_keys` with `restrict`: commands only, no terminal
   or forwarding. The user has no sudo.
3. `deploy.sh` runs there. It takes `~/.deploy.lock`, fills the digest into
   the unit and has the server's own Quadlet check it (`quadlet -dryrun`).
   Then it pulls the image (public on GHCR, no login) and makes the data
   folder. Anything failing so far leaves the running game as it was.
4. It installs the unit, runs `systemctl --user daemon-reload`, restarts
   `voidmarch.service` and waits up to three minutes for
   `http://127.0.0.1:<port>/healthz`.
5. Back on the runner, the job checks `SERVER_URL/healthz` through Caddy.

`make test-scripts` runs `deploy.sh` against stubs (`deploy_test.sh`).

### Development and its previews

Development is one slot, port 8122 and the user `voidmarch-development`,
taken by `main` and by labeled PRs in turn: the last deploy is the one
running.

- A merge to `main` installs `development.container`, on `~/data/voidmarch`,
  and removes `~/.pr`.
- Adding the `deploy:dev` label to a PR, and every push to it while it has the
  label, builds `:pr-<n>` and installs `development-preview.container` in the
  same unit's place. It runs on its own database, `~/data/preview`, so a PR's
  migrations never touch `main`'s. Redeploying the same PR keeps that
  database; when the slot goes to another PR, it is emptied first.
- The next merge to `main` takes the slot back, with `main`'s database as it
  was.

The job runs on `pull_request_target`, so `main`'s copy of `deploy.yml`,
`deploy-ssh.sh`, `deploy.sh` and the units runs, never the PR's: the PR's tree
is only the context of the Docker build. Its build writes to its own cache
scope, `preview`. `main`'s deploys and the previews queue separately and are
never cancelled halfway; the lock makes them change the server one at a time.

## One-time setup

The server side comes from linuxeverywhere-infra: each environment's user, its
lingering and subordinate ids, `~/data` labelled for containers, the public
half of its deploy key and Caddy's site.

### GitHub environments

`production`, `staging` and `development`, under Settings, Environments, each
limited to deploying from `main`. On each:

- Secrets:
  - `SSH_HOST`: `zoot.linuxeverywhere.link`, the same on all three.
  - `SSH_USER`: `voidmarch-<env>`, the environment's own user.
  - `SSH_KEY`: the private half of the key whose public half linuxeverywhere-infra
    puts in that user's `authorized_keys`.
- Variables:
  - `SERVER_URL`: the environment's address from the table above. The deploy
    checks `SERVER_URL/healthz`.

A new key pair, made on your own machine: the private half goes into the
secret, the public half into linuxeverywhere-infra's
`ansible/roles/voidmarch/defaults/main.yml`, and `zoot.yml` puts it on the
server.

```bash
env=production   # or staging, development
ssh-keygen -t ed25519 -N '' -C "voidmarch-$env deploy" -f "voidmarch-$env"
gh secret set SSH_KEY --repo starquake/voidmarch --env "$env" < "voidmarch-$env"
```

### The image on GHCR

CI publishes `ghcr.io/starquake/voidmarch` from `main`. The package is public,
like the repository, so the server and the deploy's checks pull it without
logging in; only a PR's job logs in, to push its `:pr-<n>` image. If the
package is ever made private, every deploy fails until the server logs in.

### The `deploy:dev` label

```bash
gh label create deploy:dev --repo starquake/voidmarch --color 0e8a16 --description "Deploy this PR to development"
```

Other labels don't deploy.

## By hand

### Redeploy

Actions, Deploy, Run workflow, then pick an environment. Staging deploys the
release candidate tag picked under "Use workflow from" (a branch fails);
production deploys the newest release, `:latest`; development deploys `main`'s
`:edge` (any other branch fails). A Dependabot merge deploys development this
way: `dependabot-auto-merge.yml` runs `.github/scripts/dispatch-after-merge.sh`,
which dispatches CI on `main` and, once it passes, Deploy for development.

### A shell as the environment's user

As your own user on the server, with sudo. `machinectl` gives the user's own
systemd, which `sudo -u` doesn't:

```bash
sudo machinectl shell voidmarch-production@
```

The commands below run in that shell.

### Status and logs

```bash
systemctl --user status voidmarch
journalctl --user -u voidmarch -f
podman ps
```

### Restart

```bash
systemctl --user restart voidmarch
```

### A new season

`-new-season` resets the world in the database and needs the server stopped.
The one-off container needs the unit's user mapping and mount:

```bash
systemctl --user stop voidmarch
image="$(sed -n 's/^Image=//p' ~/.config/containers/systemd/voidmarch.container)"
podman run --rm --userns=keep-id:uid=65532,gid=65532 -v ~/data/voidmarch:/data:Z,U "$image" -new-season
systemctl --user start voidmarch
```

### Backup

zoot's restic backup copies `/home`, which holds each environment's
`~/data/voidmarch`. For a copy of your own, stop the server so the SQLite file
and its WAL agree, copy, and start it again:

```bash
systemctl --user stop voidmarch
tar czf ~/voidmarch-$(date +%F).tar.gz -C ~/data/voidmarch .
systemctl --user start voidmarch
```

### Wiping development

```bash
systemctl --user stop voidmarch
rm -rf ~/data/voidmarch ~/data/preview ~/.pr
```

The next deploy starts it with a fresh database.
