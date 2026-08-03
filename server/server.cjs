const path = require('node:path')
const { FlatFile, Server } = require('boardgame.io/server')
const koaBody = require('koa-body')

const port = Number(process.env.PORT ?? 8000)
const origins = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.ngrok-free\.dev$/,
]

/**
 * Where matches live between runs. Without this the server uses boardgame.io's `InMemory` store and
 * every room dies with the process — including on the routine restarts `npm run dev:server` performs
 * whenever a file under `src/game/` changes.
 */
const MATCH_STORAGE_DIR = process.env.BLOW_COW_MATCH_DIR
  ?? path.resolve(process.cwd(), 'data', 'matches')

/**
 * How long an abandoned room survives. Persistence without expiry only trades one problem for
 * another: rooms used to be cleaned up by the restarts that destroyed them, and on disk they would
 * instead pile up in the lobby list forever. A day is long enough that a crash, a reboot, or picking
 * a game back up the next evening all recover, and short enough that the list stays honest.
 */
const ABANDONED_MATCH_TTL_MS = Number(process.env.BLOW_COW_MATCH_TTL_MS ?? 24 * 60 * 60 * 1000)
const ABANDONED_MATCH_SWEEP_INTERVAL_MS = 15 * 60 * 1000

function normalizePlayerName(playerName) {
  return typeof playerName === 'string' ? playerName.trim() : ''
}

/**
 * Clears every `isConnected` flag in storage.
 *
 * boardgame.io writes connection status into match metadata, and only ever writes `false` from the
 * socket's disconnect handler. A process that dies never runs that handler, so persisted metadata
 * comes back claiming everyone is still online — which is exactly the state the `/rejoin` route
 * below refuses with a 409, and which the lobby's "Rejoin This Room" button keys off the absence of.
 * Persisting matches without this would bring every room back in an unenterable state.
 *
 * Sockets outlive nothing here: a freshly opened store has no live connections by definition, so
 * this is a statement of fact rather than a repair. Running it inside `connect()` is what makes that
 * true — `Server.run` awaits the store before it starts listening, so no client can have connected
 * yet and no genuine `true` can be clobbered.
 */
async function releaseStaleConnections(db) {
  const matchIDs = await db.listMatches()
  let releasedMatchCount = 0

  for (const matchID of matchIDs) {
    const { metadata } = await db.fetch(matchID, { metadata: true })
    if (!metadata?.players) {
      continue
    }

    let hasStaleConnection = false
    for (const playerMetadata of Object.values(metadata.players)) {
      if (playerMetadata.isConnected === true) {
        playerMetadata.isConnected = false
        hasStaleConnection = true
      }
    }

    if (hasStaleConnection) {
      await db.setMetadata(matchID, metadata)
      releasedMatchCount += 1
    }
  }

  return releasedMatchCount
}

/**
 * Deletes rooms nobody has touched for `ABANDONED_MATCH_TTL_MS`.
 *
 * Occupancy is checked as well as age because `updatedAt` only moves on moves and match creation —
 * a table sitting in staging with players connected can go quiet for a long time without being
 * abandoned, and wiping it out from under them would be worse than the clutter this prevents.
 */
async function sweepAbandonedMatches(db) {
  const cutoff = Date.now() - ABANDONED_MATCH_TTL_MS
  const matchIDs = await db.listMatches()
  let wipedMatchCount = 0

  for (const matchID of matchIDs) {
    const { metadata } = await db.fetch(matchID, { metadata: true })
    if (!metadata) {
      continue
    }

    const isOccupied = Object.values(metadata.players ?? {}).some(
      (playerMetadata) => playerMetadata.isConnected === true,
    )
    const updatedAt = typeof metadata.updatedAt === 'number' ? metadata.updatedAt : 0

    if (isOccupied || updatedAt > cutoff) {
      continue
    }

    await db.wipe(matchID)
    wipedMatchCount += 1
  }

  return wipedMatchCount
}

/**
 * Subclassed rather than reset from `main` so the stale-connection sweep lands in the one window
 * where it is provably safe: after the store is readable and before the server accepts connections.
 */
class BlowCowMatchStore extends FlatFile {
  async connect() {
    await super.connect()

    const releasedMatchCount = await releaseStaleConnections(this)
    if (releasedMatchCount > 0) {
      console.log(`Released stale seats in ${releasedMatchCount} match(es) after restart.`)
    }
  }
}

async function main() {
  const [{ BlowCowGame }, { installCompletedGameArchiver }, { getRoomClearBlockReason }] = await Promise.all([
    import('../src/game/blowCowGame.ts'),
    import('./completedGameArchive.ts'),
    import('../src/lobbyRooms.ts'),
  ])

  const db = new BlowCowMatchStore({ dir: MATCH_STORAGE_DIR })
  const server = Server({
    db,
    games: [BlowCowGame],
    origins,
  })
  installCompletedGameArchiver(server.db)

  server.router.post('/games/:name/:id/rejoin', koaBody(), async (ctx) => {
    const gameName = ctx.params.name
    const matchID = ctx.params.id
    const playerID = ctx.request.body.playerID
    const playerName = normalizePlayerName(ctx.request.body.playerName)

    if (gameName !== BlowCowGame.name) {
      ctx.throw(404, `Game ${gameName} not found`)
    }

    if (!playerID) {
      ctx.throw(403, 'playerID is required')
    }

    if (!playerName) {
      ctx.throw(403, 'playerName is required')
    }

    const { metadata } = await server.db.fetch(matchID, { metadata: true })
    if (!metadata) {
      ctx.throw(404, 'Match ' + matchID + ' not found')
    }

    const playerMetadata = metadata.players[playerID]
    if (!playerMetadata) {
      ctx.throw(404, 'Player ' + playerID + ' not found')
    }

    if (!playerMetadata.name) {
      ctx.throw(409, 'Player ' + playerID + ' is not claimed')
    }

    if (normalizePlayerName(playerMetadata.name) !== playerName) {
      ctx.throw(403, 'Player ' + playerID + ' is not available for ' + playerName)
    }

    if (playerMetadata.isConnected === true) {
      ctx.throw(409, 'Player ' + playerID + ' is currently online')
    }

    const playerCredentials = await server.auth.generateCredentials(ctx)
    playerMetadata.name = playerName
    playerMetadata.credentials = playerCredentials

    await server.db.setMetadata(matchID, metadata)
    ctx.body = { playerID, playerCredentials }
  })

  /**
   * Deletes a room outright. The manual counterpart to the sweeper: persistence means an abandoned
   * table now sits in the lobby for a day, and this is how anyone shortens that.
   *
   * Unauthenticated on purpose — the rule is about the room's state, not about who is asking, and
   * requiring credentials would leave exactly the rooms nobody can produce credentials for as the
   * ones nobody can clear. `getRoomClearBlockReason` is the same check the lobby's button reads, so
   * a refusal here means the room changed since that card was drawn, not that the two disagree.
   */
  server.router.post('/games/:name/:id/clear', async (ctx) => {
    const gameName = ctx.params.name
    const matchID = ctx.params.id

    if (gameName !== BlowCowGame.name) {
      ctx.throw(404, `Game ${gameName} not found`)
    }

    const { metadata } = await server.db.fetch(matchID, { metadata: true })
    if (!metadata) {
      ctx.throw(404, 'Match ' + matchID + ' not found')
    }

    const clearBlockReason = getRoomClearBlockReason({
      players: Object.values(metadata.players ?? {}),
      gameover: metadata.gameover,
    })
    if (clearBlockReason) {
      ctx.throw(409, clearBlockReason)
    }

    await server.db.wipe(matchID)
    ctx.body = { matchID }
  })

  await server.run(port, () => {
    console.log(`boardgame.io server running on http://localhost:${port}`)
    console.log(`Matches persist in ${MATCH_STORAGE_DIR}`)
  })

  const runSweep = async () => {
    try {
      const wipedMatchCount = await sweepAbandonedMatches(server.db)
      if (wipedMatchCount > 0) {
        console.log(`Wiped ${wipedMatchCount} abandoned match(es).`)
      }
    } catch (error) {
      // A failed sweep is housekeeping falling behind, not a reason to take the table down.
      console.error('Abandoned match sweep failed', error)
    }
  }

  await runSweep()
  // Unreferenced so the sweep timer alone never keeps the process alive.
  setInterval(() => {
    void runSweep()
  }, ABANDONED_MATCH_SWEEP_INTERVAL_MS).unref()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
