import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type {
  BlowCowArchiveInitialState,
  BlowCowCard,
  BlowCowGameOver,
  BlowCowPlayerMatchStats,
  BlowCowScoredSet,
  BlowCowState,
} from '../src/game/blowCowGame.ts'

type CompletedGameArchivePlayerMetadata = {
  name?: string | null
}

type CompletedGameArchiveMetadata = {
  gameName?: string
  createdAt?: number
  updatedAt?: number
  setupData?: unknown
  gameover?: BlowCowGameOver | null
  players?: Record<string, CompletedGameArchivePlayerMetadata>
}

type CompletedGameArchiveStoredState = {
  G: BlowCowState
  ctx: {
    gameover?: BlowCowGameOver | null
  }
  [key: string]: unknown
}

type CompletedGameArchiveFetchOptions = {
  state?: boolean
  metadata?: boolean
  log?: boolean
  initialState?: boolean
}

type CompletedGameArchiveFetchResult = {
  state?: CompletedGameArchiveStoredState
  metadata?: CompletedGameArchiveMetadata
  log?: unknown[]
  initialState?: unknown
}

type CompletedGameArchiveDB = {
  fetch: (matchID: string, opts: CompletedGameArchiveFetchOptions) => CompletedGameArchiveFetchResult
  setState: (matchID: string, state: CompletedGameArchiveStoredState, deltalog?: unknown[]) => void
  setMetadata: (matchID: string, metadata: CompletedGameArchiveMetadata) => void
}

type CompletedGameArchiveMetadataBlock = {
  gameName: string | null
  roomCreatedAt: string | null
  roomUpdatedAt: string | null
  matchStartedAt: string | null
  matchFinishedAt: string | null
  matchDurationMs: number | null
  roomLifetimeMs: number | null
  playerCount: number
  setupData: unknown
}

const COMPLETED_GAMES_ROOT = path.resolve(process.cwd(), 'data', 'completed-games')
const COMPLETED_GAMES_MATCHES_DIR = path.join(COMPLETED_GAMES_ROOT, 'matches')
const COMPLETED_GAMES_INDEX_DIR = path.join(COMPLETED_GAMES_ROOT, 'index')

function cloneSerializable<Value>(value: Value): Value {
  if (value === undefined) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as Value
}

function cloneCards(cards: BlowCowCard[]) {
  return cards.map((card) => ({ ...card }))
}

function cloneScoredSets(scoredSets: BlowCowScoredSet[]) {
  return scoredSets.map((scoredSet) => ({
    ...scoredSet,
    cards: cloneCards(scoredSet.cards),
  }))
}

function toIsoString(timestamp: number | null | undefined) {
  return typeof timestamp === 'number' ? new Date(timestamp).toISOString() : null
}

function formatArchiveFileTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().replace(/[:.]/g, '-')
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function toRelativeProjectPath(filePath: string) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/')
}

function ensureArchiveDirectories() {
  if (!existsSync(COMPLETED_GAMES_MATCHES_DIR)) {
    mkdirSync(COMPLETED_GAMES_MATCHES_DIR, { recursive: true })
  }

  if (!existsSync(COMPLETED_GAMES_INDEX_DIR)) {
    mkdirSync(COMPLETED_GAMES_INDEX_DIR, { recursive: true })
  }
}

function getPlayerName(metadata: CompletedGameArchiveMetadata | undefined, playerID: string) {
  const playerName = metadata?.players?.[playerID]?.name
  return typeof playerName === 'string' && playerName.trim().length > 0 ? playerName.trim() : null
}

function buildMetadataBlock(
  metadata: CompletedGameArchiveMetadata | undefined,
  startedAt: number | null,
  finishedAt: number,
  playerCount: number,
): CompletedGameArchiveMetadataBlock {
  const roomCreatedAt = typeof metadata?.createdAt === 'number' ? metadata.createdAt : null
  const roomUpdatedAt = typeof metadata?.updatedAt === 'number' ? metadata.updatedAt : finishedAt
  const matchStartedAt = startedAt ?? roomCreatedAt

  return {
    gameName: metadata?.gameName ?? null,
    roomCreatedAt: toIsoString(roomCreatedAt),
    roomUpdatedAt: toIsoString(roomUpdatedAt),
    matchStartedAt: toIsoString(matchStartedAt),
    matchFinishedAt: toIsoString(finishedAt),
    matchDurationMs: matchStartedAt !== null ? Math.max(0, finishedAt - matchStartedAt) : null,
    roomLifetimeMs: roomCreatedAt !== null ? Math.max(0, finishedAt - roomCreatedAt) : null,
    playerCount,
    setupData: cloneSerializable(metadata?.setupData ?? null),
  }
}

function buildInitialArchive(
  initialArchive: BlowCowArchiveInitialState | null,
  metadata: CompletedGameArchiveMetadata | undefined,
) {
  if (!initialArchive) {
    return null
  }

  return {
    playerCount: initialArchive.playerCount,
    playerOrder: [...initialArchive.playerOrder],
    startingPlayerID: initialArchive.startingPlayerID,
    startingPlayerName: getPlayerName(metadata, initialArchive.startingPlayerID),
    direction: initialArchive.direction,
    deckConfig: cloneSerializable(initialArchive.deckConfig),
    speedMultiplier: initialArchive.speedMultiplier,
    useCharacters: initialArchive.useCharacters,
    characterPool: [...initialArchive.characterPool],
    players: initialArchive.playerOrder.map((playerID) => {
      const player = initialArchive.players[playerID]
      return {
        playerID,
        playerName: getPlayerName(metadata, playerID),
        seatIndex: player.seatIndex,
        character: player.character,
        initialHand: cloneCards(player.hand),
        initialPoints: player.points,
        initialScoredSets: cloneScoredSets(player.scoredSets),
      }
    }),
  }
}

function buildEndgameArchive(
  state: BlowCowState,
  metadata: CompletedGameArchiveMetadata | undefined,
  gameover: BlowCowGameOver | null | undefined,
) {
  const placements = (gameover?.placements ?? state.placements).map((playerID, index) => ({
    place: index + 1,
    playerID,
    playerName: getPlayerName(metadata, playerID),
  }))
  const pointsByPlayer = gameover?.pointsByPlayer ?? Object.fromEntries(
    Object.entries(state.players).map(([playerID, player]) => [playerID, player.points]),
  )

  return {
    winnerID: gameover?.winnerID ?? placements[0]?.playerID ?? null,
    winnerName: gameover?.winnerID ? getPlayerName(metadata, gameover.winnerID) : placements[0]?.playerName ?? null,
    placements,
    pointsByPlayer: cloneSerializable(pointsByPlayer),
    players: state.seatOrder.map((playerID) => {
      const player = state.players[playerID]
      const placementIndex = placements.findIndex((entry) => entry.playerID === playerID)
      return {
        playerID,
        playerName: getPlayerName(metadata, playerID),
        seatIndex: player.seatIndex,
        character: player.character,
        points: player.points,
        leaveOrder: player.leaveOrder,
        place: placementIndex >= 0 ? placementIndex + 1 : null,
        matchStats: cloneSerializable<BlowCowPlayerMatchStats>(player.matchStats),
      }
    }),
  }
}

function buildArchiveDocument(
  matchID: string,
  snapshot: CompletedGameArchiveFetchResult,
  startedAt: number | null,
  finishedAt: number,
  relativeFilePath: string,
) {
  const state = snapshot.state?.G
  if (!state) {
    return null
  }

  const metadataBlock = buildMetadataBlock(snapshot.metadata, startedAt, finishedAt, state.seatOrder.length)
  const initialArchive = buildInitialArchive(state.archive.initial, snapshot.metadata)
  const endgameArchive = buildEndgameArchive(state, snapshot.metadata, snapshot.metadata?.gameover ?? snapshot.state?.ctx.gameover)

  return {
    schemaVersion: 1,
    format: 'blowcow-completed-game',
    matchID,
    file: relativeFilePath,
    archivedAt: toIsoString(finishedAt),
    metadata: metadataBlock,
    initial: initialArchive,
    turns: cloneSerializable(state.archive.turns),
    history: cloneSerializable(state.history),
    telemetry: cloneSerializable(state.telemetry),
    endgame: endgameArchive,
    raw: {
      metadata: cloneSerializable(snapshot.metadata ?? null),
      state: cloneSerializable(snapshot.state ?? null),
      initialState: cloneSerializable(snapshot.initialState ?? null),
      log: cloneSerializable(snapshot.log ?? []),
    },
  }
}

function buildGameIndexEntry(
  matchID: string,
  relativeFilePath: string,
  metadata: CompletedGameArchiveMetadataBlock,
  endgame: ReturnType<typeof buildEndgameArchive>,
) {
  return {
    schemaVersion: 1,
    matchID,
    file: relativeFilePath,
    gameName: metadata.gameName,
    roomCreatedAt: metadata.roomCreatedAt,
    matchStartedAt: metadata.matchStartedAt,
    matchFinishedAt: metadata.matchFinishedAt,
    matchDurationMs: metadata.matchDurationMs,
    playerCount: metadata.playerCount,
    winnerID: endgame.winnerID,
    winnerName: endgame.winnerName,
    placements: endgame.placements,
    players: endgame.players.map((player) => ({
      playerID: player.playerID,
      playerName: player.playerName,
      character: player.character,
      place: player.place,
      points: player.points,
      leaveOrder: player.leaveOrder,
    })),
  }
}

function buildPlayerIndexEntries(
  matchID: string,
  relativeFilePath: string,
  metadata: CompletedGameArchiveMetadataBlock,
  endgame: ReturnType<typeof buildEndgameArchive>,
) {
  return endgame.players.map((player) => ({
    schemaVersion: 1,
    matchID,
    file: relativeFilePath,
    roomCreatedAt: metadata.roomCreatedAt,
    matchStartedAt: metadata.matchStartedAt,
    matchFinishedAt: metadata.matchFinishedAt,
    matchDurationMs: metadata.matchDurationMs,
    playerID: player.playerID,
    playerName: player.playerName,
    character: player.character,
    seatIndex: player.seatIndex,
    place: player.place,
    points: player.points,
    leaveOrder: player.leaveOrder,
    playCount: player.matchStats.playCount,
    callBSCount: player.matchStats.callBSCount,
    passCount: player.matchStats.passCount,
    resetCount: player.matchStats.resetCount,
    turnsInGame: player.matchStats.turnsInGame,
    lieCount: player.matchStats.lieCount,
    lieRate: player.matchStats.playCount > 0 ? player.matchStats.lieCount / player.matchStats.playCount : null,
    cardsPlayed: player.matchStats.cardsPlayed,
    punishmentCount: player.matchStats.punishmentCount,
    bsWinCount: player.matchStats.bsWinCount,
    // Additive within schemaVersion 1: the per-match snapshot already carries the whole matchStats
    // object, so leaving these out would only make this compact line disagree with it.
    accusationCount: player.matchStats.accusationCount,
    accusationWinCount: player.matchStats.accusationWinCount,
  }))
}

function appendNdjsonLine(filePath: string, value: unknown) {
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function archiveCompletedMatch(
  db: CompletedGameArchiveDB,
  matchID: string,
  startedAt: number | null,
) {
  const snapshot = db.fetch(matchID, {
    state: true,
    metadata: true,
    log: true,
    initialState: true,
  })
  const state = snapshot.state?.G
  const gameover = snapshot.metadata?.gameover ?? snapshot.state?.ctx.gameover

  if (!state || state.gameStatus !== 'finished' || !gameover) {
    return null
  }

  const finishedAt = typeof snapshot.metadata?.updatedAt === 'number' ? snapshot.metadata.updatedAt : Date.now()
  const archiveFileName = `${formatArchiveFileTimestamp(finishedAt)}--${sanitizePathSegment(matchID)}.json`
  const archiveFilePath = path.join(COMPLETED_GAMES_MATCHES_DIR, archiveFileName)
  const relativeFilePath = toRelativeProjectPath(archiveFilePath)
  const archiveDocument = buildArchiveDocument(matchID, snapshot, startedAt, finishedAt, relativeFilePath)

  if (!archiveDocument) {
    return null
  }

  writeFileSync(archiveFilePath, `${JSON.stringify(archiveDocument, null, 2)}\n`, 'utf8')

  const endgameArchive = buildEndgameArchive(state, snapshot.metadata, gameover)
  const metadataBlock = buildMetadataBlock(snapshot.metadata, startedAt, finishedAt, state.seatOrder.length)
  appendNdjsonLine(
    path.join(COMPLETED_GAMES_INDEX_DIR, 'games.ndjson'),
    buildGameIndexEntry(matchID, relativeFilePath, metadataBlock, endgameArchive),
  )

  for (const playerEntry of buildPlayerIndexEntries(matchID, relativeFilePath, metadataBlock, endgameArchive)) {
    appendNdjsonLine(path.join(COMPLETED_GAMES_INDEX_DIR, 'player-games.ndjson'), playerEntry)
  }

  return archiveFilePath
}

export function installCompletedGameArchiver(db: CompletedGameArchiveDB) {
  const matchStartedAtByID = new Map<string, number>()
  const archivedMatchIDs = new Set<string>()
  const originalSetState = db.setState.bind(db)
  const originalSetMetadata = db.setMetadata.bind(db)

  db.setState = (matchID, state, deltalog) => {
    if (state?.G?.gameStatus === 'active' && !matchStartedAtByID.has(matchID)) {
      matchStartedAtByID.set(matchID, Date.now())
    }

    originalSetState(matchID, state, deltalog)
  }

  db.setMetadata = (matchID, metadata) => {
    originalSetMetadata(matchID, metadata)

    if (archivedMatchIDs.has(matchID) || metadata.gameover === undefined || metadata.gameover === null) {
      return
    }

    ensureArchiveDirectories()
    archiveCompletedMatch(db, matchID, matchStartedAtByID.get(matchID) ?? null)
    archivedMatchIDs.add(matchID)
  }
}