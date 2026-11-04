# safety-net

Pi extension. Blocks destructive commands and secret access before the tool call runs. It parses what a command does, so flag reordering, shell wrappers, and interpreter one-liners cannot bypass it.

Blocked: `rm -rf` on destructive targets, `git reset --hard`, `git checkout --`, `git push --force`, unsafe `find -delete`, `dd`, `mkfs`, `shred`. Allowed: everything else, including `git checkout -b`. Content access to SSH keys, `.env` files, and cloud credentials is also blocked.

Shipped as a prebuilt `dist/` bundle. Only `./dist/pi/index.js` loads in Pi. Do not prune it.

## Install

Install via the pi-craft installer (`bun run install` from repo root).

## License

MIT. See LICENSE and THIRD_PARTY_LICENSES.txt. Upstream source retains original copyright.
