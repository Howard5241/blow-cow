const { Server } = require('boardgame.io/server')
const koaBody = require('koa-body')

const port = Number(process.env.PORT ?? 8000)
const origins = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.ngrok-free\.dev$/,
]

function normalizePlayerName(playerName) {
  return typeof playerName === 'string' ? playerName.trim() : ''
}

async function main() {
  const [{ BlowCowGame }, { installCompletedGameArchiver }] = await Promise.all([
    import('../src/game/blowCowGame.ts'),
    import('./completedGameArchive.ts'),
  ])

  const server = Server({
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

  server.run(port, () => {
    console.log(`boardgame.io server running on http://localhost:${port}`)
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})