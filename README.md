# FreeGames

A self-hosted bot that announces free game giveaways into a channel on your
[Fluxer](https://fluxer.app) instance. Inspired by free-game bots elsewhere; built
for self-hosters.

**What it does**

- Polls public giveaway sources on a schedule:
  - **Epic Games Store** — weekly free games, straight from Epic's public
    catalog API (real prices, key art, exact end times).
  - **GamerPower** — aggregates Steam, GOG, itch.io, Ubisoft, IndieGala,
    Fanatical, Alienware and more. Epic items are skipped there to avoid
    duplicates.
- Posts a rich embed (banner image, original price struck through, claim link,
  end time) into the configured channel.
- When a deal ends (its end time passes, or it disappears from the source),
  adds a ❌ reaction to its announcement message to mark it as done.
- Remembers what it already announced across restarts (`data/state.json`).

## Setup

### 1. Create the bot on your Fluxer instance

1. In the Fluxer client: **User Settings → Applications** and create a new
   application/bot named `FreeGames`.
2. Copy the bot token it issues.
3. Add the bot to your server and make sure it can see the target channel with
   **Send Messages**, **Embed Links** and **Add Reactions** permissions.

### 2. Configure

```bash
cp .env.example .env
cp config.example.json config.json
```

Edit `.env`:

| Variable | Description |
| --- | --- |
| `FLUXER_BOT_TOKEN` | Token issued by **your** instance (tokens are not portable between instances). |
| `FLUXER_INSTANCE_ORIGIN` | e.g. `https://chat.example.com`. The bot reads `/.well-known/fluxer` from it. |

Edit `config.json`:

| Key | Default | Description |
| --- | --- | --- |
| `guildId` | `"auto"` | Guild (server) ID, or `auto` to use the first guild the bot is in. |
| `channel` | `"free-games"` | Channel **name** to announce in. A numeric value is treated as a channel ID. |
| `pollIntervalMinutes` | `60` | How often to check the sources. |
| `reapIntervalMinutes` | `60` | How often to check for finished deals (adds the ❌). |
| `endGraceMinutes` | `10` | Extra delay after an end time before marking done. |
| `epic.country` | `"US"` | Epic store country — affects currency/prices. Use e.g. `PT` for euro pricing. |
| `epic.locale` | `"en-US"` | Epic store locale. |
| `gamerpower.maxOpenEndedAgeDays` | `15` | Giveaways with no end date are treated as fresh for this many days after publication; older ones are skipped (and their announcements marked done) — the feed never expires some entries, and they are usually long-dead key packs. `0` disables the guard. |
| `filters.stores` | see below | Store slugs to allow: `epic`, `steam`, `gog`, `itch`, `ubisoft`, `indiegala`, `fanatical`, `alienware`. Empty = all. |
| `filters.platforms` | `["pc"]` | Platform slugs to allow: `pc`, `android`, `ios`, `xbox`, `playstation`, `switch`, `vr`, `browser`. Empty = all. |
| `filters.types` | `["game", "dlc"]` | Giveaway types to allow: `game`, `dlc`, `early-access`, `beta`, `alpha`, `demo`, `loot`. Empty = all. |

### 3. Run

Local (Node ≥ 22.13):

```bash
pnpm install
pnpm start                 # continuous
pnpm start -- --once       # single poll + reap pass, then exit
pnpm start -- --dry-run    # log what would be posted, send nothing, write no state
pnpm start -- --announce-existing   # first run: post everything currently free
```

Docker (local):

```bash
docker compose up -d --build
docker compose logs -f
```

The container mounts `config.json` (read-only) and the `data/` directory so the
announced-games state survives rebuilds. It runs as the non-root `node` user
and reports its health from the gateway heartbeat (a stale heartbeat means the
container gets restarted).

## Deploys (CI/CD)

Every push to `main` (and every `v*` tag) builds a **multi-arch image**
(`linux/amd64` + `linux/arm64`) in GitHub Actions and publishes it to GitHub
Container Registry as `ghcr.io/<owner>/fluxer-freegames` (see
`.github/workflows/docker.yml`):

| Event | Image tags |
| --- | --- |
| push to `main` | `latest`, `main`, `sha-<short>` |
| push of `v1.2.3` | `1.2.3`, `1.2`, `1` (+ GitHub Release) |
| pull request | build only — nothing is pushed |

Releasing:

1. Bump `version` in `package.json` (the workflow refuses `v*` tags that
   disagree with it).
2. Tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. CI builds the image and creates the GitHub Release with generated notes.

Deploying on a server:

```bash
mkdir fluxer-freegames && cd fluxer-freegames
# provide: compose.yaml, .env, config.json  (data/ is created automatically)
docker compose pull && docker compose up -d
```

`compose.yaml` pins the image by semver tag; Renovate (see `renovate.json`)
opens PRs to bump the pin whenever a new `v*` release is tagged, so a deploy
is just "merge the Renovate PR, then `docker compose pull && up -d`".
State in `data/` survives upgrades, so announced deals still get their ❌
reaction after a restart.

## Behaviour notes

- **First run is silent**: it baselines the currently active giveaways without
  spamming the channel and only announces *new* ones from then on. Start once
  with `--announce-existing` if you want the current lineup posted immediately.
- **Dry runs leave no trace**: nothing is sent and `data/state.json` is not
  written, so a dry run never suppresses future real announcements.
- **Finished deals**: the ❌ reaction is added when the end time passes (plus
  grace) or when a healthy source stops listing the giveaway. If the
  announcement message was deleted, the entry is closed silently. After 5
  failed attempts to react, the bot gives up on a message and closes it.
- **Source failures** are logged and skipped for that cycle; one dead source
  never stops the other.
- **State retention**: seen/closed entries older than ~45 days are pruned.

## Project layout

```
src/
├── index.ts            entrypoint: login, poll + reap loops, shutdown
├── config.ts           config.json + CLI flags
├── env.ts              tiny .env loader (no deps)
├── fluxer.ts           connect + resolve guild/channel by name
├── embed.ts            announcement embed
├── state.ts            data/state.json (seen / announced / closed)
├── reaper.ts           mark finished deals with ❌
└── sources/
    ├── types.ts        GameGiveaway model + Source interface
    ├── epic.ts         Epic Games Store catalog API
    └── gamerpower.ts   GamerPower aggregator API
```

## Security notes

- The bot token lives in `.env`, which is gitignored — never commit it. Rotate
  the token from your instance's application settings if it ever leaks.
- No inbound ports are needed; the bot only makes outbound connections.

## License

MIT — do what you want. Sources polled are public community APIs; please be
nice to them (the default 20-minute poll interval is deliberately gentle).
