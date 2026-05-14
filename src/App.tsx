import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { LobbyClient } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'
import { Client } from 'boardgame.io/react'
import { GAME_NAME, GAME_SERVER_URL, GAME_TITLE, PLAYER_NAME_STORAGE_KEY } from './config.ts'
import {
  BLOW_COW_SPEED_MULTIPLIERS,
  BLOW_COW_RANKS,
  BlowCowGame,
  DEFAULT_BLOW_COW_SPEED_MULTIPLIER,
  getDefaultStandardRankCount,
  validateBlowCowSetupData,
  type BlowCowRank,
  type BlowCowRankSelectionMode,
  type BlowCowSpeedMultiplier,
  type BlowCowSetupData,
} from './game/blowCowGame.ts'
import {
  BLOW_COW_IMPLEMENTED_CHARACTER_NAMES,
  type BlowCowImplementedCharacterName,
} from './game/blowCowCharacters.ts'
import { BlowCowBoard } from './ui/BlowCowBoard.tsx'
import './App.css'

type LobbyPlayer = {
  id: string | number
  name?: string
  isConnected?: boolean
}

type LobbyMatch = {
  matchID: string
  gameName: string
  players: LobbyPlayer[]
  createdAt?: number
  updatedAt?: number
}

type ActiveRoom = {
  matchID: string
  playerID: string
  credentials: string
  playerName: string
}

type JoinedRoom = {
  playerID: string
  playerCredentials: string
}

type BusyAction = 'create' | 'join' | 'leave' | null
type ServerState = 'checking' | 'online' | 'offline'

const lobbyClient = new LobbyClient({ server: GAME_SERVER_URL })

function TableLoading() {
  return (
    <div className="loading-card">
      <span className="status-dot" aria-hidden="true"></span>
      Connecting to the table...
    </div>
  )
}

const BlowCowClient = Client({
  game: BlowCowGame,
  board: BlowCowBoard,
  debug: false,
  loading: TableLoading,
  multiplayer: SocketIO({ server: GAME_SERVER_URL }),
})

async function requestMatches() {
  const { matches } = await lobbyClient.listMatches(GAME_NAME)
  return matches as LobbyMatch[]
}

async function requestMatch(matchID: string) {
  const match = await lobbyClient.getMatch(GAME_NAME, matchID)
  return match as LobbyMatch
}

async function reclaimOfflineSeat(matchID: string, playerID: string, playerName: string) {
  const response = await fetch(`${GAME_SERVER_URL}/games/${GAME_NAME}/${matchID}/rejoin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ playerID, playerName }),
  })

  if (!response.ok) {
    throw new Error((await response.text()) || 'Could not reclaim that offline seat.')
  }

  return await response.json() as JoinedRoom
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong while contacting the lobby.'
}

function getAvailableSeatCount(match: LobbyMatch) {
  return match.players.filter((player) => !player.name).length
}

function getRejoinableOfflinePlayer(match: Pick<LobbyMatch, 'players'>, playerName: string) {
  const normalizedPlayerName = playerName.trim()
  if (!normalizedPlayerName) {
    return null
  }

  return match.players.find((player) => player.name === normalizedPlayerName && player.isConnected === false) ?? null
}

function formatRoomSeatLabel(player: LobbyPlayer) {
  if (!player.name) {
    return 'Open'
  }

  return player.isConnected === false ? `${player.name} (Offline)` : player.name
}

function formatTimestamp(value?: number) {
  if (!value) {
    return 'Just now'
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)
}

function getServerStateLabel(serverState: ServerState) {
  switch (serverState) {
    case 'online':
      return 'Server Online'
    case 'offline':
      return 'Server Offline'
    default:
      return 'Checking Server'
  }
}

function sortSelectedRanks(selectedRanks: BlowCowRank[]) {
  return [...selectedRanks].sort(
    (leftRank, rightRank) => BLOW_COW_RANKS.indexOf(leftRank) - BLOW_COW_RANKS.indexOf(rightRank),
  )
}

function sortSelectedCharacterPool(selectedCharacterPool: BlowCowImplementedCharacterName[]) {
  return BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.filter((characterName) => selectedCharacterPool.includes(characterName))
}

function App() {
  const [playerName, setPlayerName] = useState(
    () => window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? '',
  )
  const [roomCode, setRoomCode] = useState('')
  const [numPlayers, setNumPlayers] = useState(4)
  const [speedMultiplier, setSpeedMultiplier] = useState<BlowCowSpeedMultiplier>(DEFAULT_BLOW_COW_SPEED_MULTIPLIER)
  const [useCharacters, setUseCharacters] = useState(true)
  const [rankSelectionMode, setRankSelectionMode] = useState<BlowCowRankSelectionMode>('default')
  const [manualSelectedRanks, setManualSelectedRanks] = useState<BlowCowRank[]>([])
  const [selectedCharacterPool, setSelectedCharacterPool] = useState<BlowCowImplementedCharacterName[]>(
    () => [...BLOW_COW_IMPLEMENTED_CHARACTER_NAMES],
  )
  const [matches, setMatches] = useState<LobbyMatch[]>([])
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null)
  const [activeRoomPlayers, setActiveRoomPlayers] = useState<LobbyPlayer[]>([])
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [serverState, setServerState] = useState<ServerState>('checking')
  const [statusMessage, setStatusMessage] = useState('Checking the lobby service...')
  const [errorMessage, setErrorMessage] = useState('')
  const [tableShellAccent, setTableShellAccent] = useState('amber')

  const defaultRankCount = getDefaultStandardRankCount(numPlayers)
  const trimmedPlayerName = playerName.trim()
  const defaultDeckDescription = defaultRankCount === BLOW_COW_RANKS.length
    ? 'Use all 13 standard ranks and always include 2 Jokers.'
    : `Randomly select ${defaultRankCount} standard ranks and always include 2 Jokers.`
  const isConfusedAvailableInManualDeck = rankSelectionMode !== 'manual' || manualSelectedRanks.includes('J')
  const effectiveCharacterPool = isConfusedAvailableInManualDeck
    ? selectedCharacterPool
    : selectedCharacterPool.filter((characterName) => characterName !== 'The Confused')
  const isUsingDefaultCharacterPool = effectiveCharacterPool.length === BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.length
  const hasUnavailableConfusedSelection = !isConfusedAvailableInManualDeck && selectedCharacterPool.includes('The Confused')
  const createRoomSetupData: BlowCowSetupData = {
    rankSelectionMode,
    ...(rankSelectionMode === 'manual' ? { selectedRanks: manualSelectedRanks } : {}),
    speedMultiplier,
    useCharacters,
    ...(useCharacters && !isUsingDefaultCharacterPool ? { characterPool: effectiveCharacterPool } : {}),
  }
  const createRoomSetupError = validateBlowCowSetupData(createRoomSetupData)
  const isManualRankSelectionInvalid = rankSelectionMode === 'manual' && manualSelectedRanks.length < 2
  const isCharacterPoolInvalid = useCharacters && effectiveCharacterPool.length < 1

  useEffect(() => {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName)
  }, [playerName])

  useEffect(() => {
    if (activeRoom) {
      return
    }

    let cancelled = false

    const syncMatches = async (showLoading: boolean) => {
      if (showLoading) {
        setIsRefreshing(true)
      }

      try {
        const nextMatches = await requestMatches()

        if (cancelled) {
          return
        }

        setMatches(nextMatches)
        setServerState('online')
        setStatusMessage(
          nextMatches.length > 0
            ? 'Open rooms are live. Enter your name and take a seat.'
            : 'No rooms are open yet. Create the first table.',
        )
        setErrorMessage('')
      } catch (error) {
        if (cancelled) {
          return
        }

        setServerState('offline')
        setStatusMessage(
          'Lobby service is offline. Start the boardgame.io server to create and join rooms.',
        )
        setErrorMessage(getErrorMessage(error))
      } finally {
        if (!cancelled && showLoading) {
          setIsRefreshing(false)
        }
      }
    }

    void syncMatches(true)

    const timer = window.setInterval(() => {
      void syncMatches(false)
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeRoom])

  useEffect(() => {
    if (!activeRoom) {
      setActiveRoomPlayers([])
      return
    }

    let cancelled = false

    const syncRoomPlayers = async () => {
      try {
        const match = await lobbyClient.getMatch(GAME_NAME, activeRoom.matchID)

        if (cancelled) {
          return
        }

        setActiveRoomPlayers(match.players as LobbyPlayer[])
      } catch (error) {
        if (cancelled) {
          return
        }

        setErrorMessage(getErrorMessage(error))
      }
    }

    void syncRoomPlayers()

    const timer = window.setInterval(() => {
      void syncRoomPlayers()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeRoom])

  const sortedMatches = [...matches].sort(
    (left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0),
  )

  const isBusy = busyAction !== null

  const requirePlayerName = () => {
    const trimmedName = playerName.trim()

    if (!trimmedName) {
      setErrorMessage('Enter your name before creating or joining a room.')
      return null
    }

    return trimmedName
  }

  const handleRefreshRooms = async () => {
    setIsRefreshing(true)

    try {
      const nextMatches = await requestMatches()
      setMatches(nextMatches)
      setServerState('online')
      setStatusMessage(
        nextMatches.length > 0
          ? 'Room list refreshed.'
          : 'Still no open rooms. Create one to get started.',
      )
      setErrorMessage('')
    } catch (error) {
      setServerState('offline')
      setStatusMessage('Lobby service is offline.')
      setErrorMessage(getErrorMessage(error))
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = requirePlayerName()
    if (!trimmedName) {
      return
    }

    const setupDataError = validateBlowCowSetupData(createRoomSetupData)
    if (setupDataError) {
      setErrorMessage(setupDataError)
      return
    }

    setBusyAction('create')
    setErrorMessage('')

    try {
      const { matchID } = await lobbyClient.createMatch(GAME_NAME, {
        numPlayers,
        setupData: createRoomSetupData,
      })
      const { playerID, playerCredentials } = await lobbyClient.joinMatch(
        GAME_NAME,
        matchID,
        { playerName: trimmedName },
      )

      setRoomCode(matchID)
      setServerState('online')
      setStatusMessage(`Room ${matchID} is ready.`)
      setActiveRoom({
        matchID,
        playerID,
        credentials: playerCredentials,
        playerName: trimmedName,
      })
    } catch (error) {
      setStatusMessage('Could not create a room.')
      setErrorMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const joinRoom = async (nextRoomCode: string) => {
    const trimmedName = requirePlayerName()
    if (!trimmedName) {
      return
    }

    const normalizedCode = nextRoomCode.trim()
    if (!normalizedCode) {
      setErrorMessage('Enter a room code or pick one from the open room list.')
      return
    }

    setBusyAction('join')
    setErrorMessage('')

    try {
      const match = await requestMatch(normalizedCode)
      const rejoinablePlayer = getRejoinableOfflinePlayer(match, trimmedName)
      const { playerID, playerCredentials } = rejoinablePlayer
        ? await reclaimOfflineSeat(normalizedCode, String(rejoinablePlayer.id), trimmedName)
        : await lobbyClient.joinMatch(
          GAME_NAME,
          normalizedCode,
          { playerName: trimmedName },
        )

      setRoomCode(normalizedCode)
      setServerState('online')
      setStatusMessage(
        rejoinablePlayer
          ? `Rejoined room ${normalizedCode} as ${trimmedName}.`
          : `Joined room ${normalizedCode}.`,
      )
      setActiveRoom({
        matchID: normalizedCode,
        playerID,
        credentials: playerCredentials,
        playerName: trimmedName,
      })
    } catch (error) {
      setStatusMessage('Could not join that room.')
      setErrorMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  const handleJoinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await joinRoom(roomCode)
  }

  const handleQuickJoin = async (matchID: string) => {
    setRoomCode(matchID)
    await joinRoom(matchID)
  }

  const toggleManualRank = (rank: BlowCowRank) => {
    setManualSelectedRanks((previousRanks) => previousRanks.includes(rank)
      ? previousRanks.filter((entry) => entry !== rank)
      : sortSelectedRanks([...previousRanks, rank]))
  }

  const toggleCharacterPoolCharacter = (characterName: BlowCowImplementedCharacterName) => {
    setSelectedCharacterPool((previousCharacterPool) => {
      const previousEffectiveCharacterPool = isConfusedAvailableInManualDeck
        ? previousCharacterPool
        : previousCharacterPool.filter((entry) => entry !== 'The Confused')

      if (previousCharacterPool.includes(characterName)) {
        if (previousEffectiveCharacterPool.length <= 1 && previousEffectiveCharacterPool.includes(characterName)) {
          return previousCharacterPool
        }

        return previousCharacterPool.filter((entry) => entry !== characterName)
      }

      return sortSelectedCharacterPool([...previousCharacterPool, characterName])
    })
  }

  const handleLeaveRoom = async () => {
    if (!activeRoom) {
      return
    }

    setBusyAction('leave')
    setErrorMessage('')

    try {
      await lobbyClient.leaveMatch(GAME_NAME, activeRoom.matchID, {
        playerID: activeRoom.playerID,
        credentials: activeRoom.credentials,
      })

      setActiveRoomPlayers([])
      setActiveRoom(null)
      setStatusMessage(`Left room ${activeRoom.matchID}.`)

      const nextMatches = await requestMatches()
      setMatches(nextMatches)
      setServerState('online')
    } catch (error) {
      setStatusMessage('Could not leave the room cleanly.')
      setErrorMessage(getErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  if (activeRoom) {
    return (
      <main className="app-shell table-mode">
        <section className="table-shell" data-ambient-accent={tableShellAccent}>
          <BlowCowClient
            credentials={activeRoom.credentials}
            isLeaving={busyAction === 'leave'}
            matchID={activeRoom.matchID}
            onLeaveRoom={handleLeaveRoom}
            onTableShellAccentChange={setTableShellAccent}
            playerID={activeRoom.playerID}
            playerName={activeRoom.playerName}
            roomPlayers={activeRoomPlayers}
            roomError={errorMessage}
            serverState={serverState}
            serverStatusLabel={getServerStateLabel(serverState)}
          />
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">{GAME_TITLE} Multiplayer Lobby</p>
        <div className="hero-header">
          <div>
            <h1>Welcome to Blow Cow.</h1>
            <p className="hero-copy">
              Enter a display name, create a room, or join an existing one by code.
            </p>
          </div>
          <span className={`status-pill ${serverState}`}>
            {getServerStateLabel(serverState)}
          </span>
        </div>
      </section>

      <section className="status-banner">
        <p>{statusMessage}</p>
        <button
          type="button"
          className="secondary-button"
          disabled={isRefreshing || isBusy}
          onClick={() => {
            void handleRefreshRooms()
          }}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh Rooms'}
        </button>
      </section>

      {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

      <section className="lobby-grid">
        <article className="panel stack-gap">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Player Setup</p>
              <h2>Enter Your Name</h2>
            </div>
            <span className="panel-badge">Required</span>
          </div>

          <label className="field">
            <span>Display Name</span>
            <input
              autoComplete="nickname"
              maxLength={24}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Dealer, AceFace, BluffBot..."
              value={playerName}
            />
          </label>

          <form className="stack-gap" onSubmit={handleCreateRoom}>
            <div className="panel-header tight">
              <div>
                <p className="panel-kicker">Create</p>
                <h2>Start a New Room</h2>
              </div>
            </div>

            <label className="field">
              <span>Seats</span>
              <select
                onChange={(event) => setNumPlayers(Number(event.target.value))}
                value={numPlayers}
              >
                <option value={2}>2 players</option>
                <option value={3}>3 players</option>
                <option value={4}>4 players</option>
                <option value={5}>5 players</option>
                <option value={6}>6 players</option>
                <option value={7}>7 players</option>
                <option value={8}>8 players</option>
              </select>
            </label>

            <label className="field">
              <span>Game Speed</span>
              <select
                onChange={(event) => setSpeedMultiplier(Number(event.target.value) as BlowCowSpeedMultiplier)}
                value={speedMultiplier}
              >
                {BLOW_COW_SPEED_MULTIPLIERS.map((multiplier) => (
                  <option key={multiplier} value={multiplier}>
                    {multiplier}x{multiplier === DEFAULT_BLOW_COW_SPEED_MULTIPLIER ? ' (Default)' : multiplier > DEFAULT_BLOW_COW_SPEED_MULTIPLIER ? ' (Faster)' : ' (Slower)'}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="deck-mode-group">
              <legend>Character Cards</legend>

              <div className="deck-mode-options">
                <label className={`deck-mode-option ${useCharacters ? 'active' : ''}`}>
                  <input
                    checked={useCharacters}
                    name="use-characters"
                    onChange={() => setUseCharacters(true)}
                    type="radio"
                    value="enabled"
                  />
                  <span className="deck-mode-title-wrap">
                    <span className="deck-mode-title">Enabled</span>
                    <span aria-hidden="true" className="deck-mode-help">?</span>
                  </span>
                  <span className="deck-mode-tooltip" role="tooltip">
                    Randomly assign each player one public character card at match start.
                  </span>
                </label>

                <label className={`deck-mode-option ${useCharacters ? '' : 'active'}`}>
                  <input
                    checked={!useCharacters}
                    name="use-characters"
                    onChange={() => setUseCharacters(false)}
                    type="radio"
                    value="disabled"
                  />
                  <span className="deck-mode-title-wrap">
                    <span className="deck-mode-title">Disabled</span>
                    <span aria-hidden="true" className="deck-mode-help">?</span>
                  </span>
                  <span className="deck-mode-tooltip" role="tooltip">
                    Start the match without any character cards or character abilities.
                  </span>
                </label>
              </div>
            </fieldset>

            {useCharacters ? (
              <div className="manual-rank-panel">
                <div className="manual-rank-header">
                  <div>
                    <p className="panel-kicker">Character Pool</p>
                    <h3>Choose Which Characters Can Appear</h3>
                    <p className="character-pool-copy">
                      Every implemented character starts in the pool. Remove cards here to narrow the random draw.
                    </p>
                  </div>
                  <span className={`rank-selection-count ${isCharacterPoolInvalid ? 'invalid' : ''}`}>
                    {effectiveCharacterPool.length} selected
                  </span>
                </div>

                <div className="character-chip-grid">
                  {BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.map((characterName) => {
                    const isSelected = effectiveCharacterPool.includes(characterName)
                    const isConfusedLocked = characterName === 'The Confused' && !isConfusedAvailableInManualDeck

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`character-chip ${isSelected ? 'selected' : ''}`}
                        disabled={isBusy || isConfusedLocked}
                        key={characterName}
                        onClick={() => {
                          toggleCharacterPoolCharacter(characterName)
                        }}
                        title={isConfusedLocked ? 'The Confused requires J to be in the manual deck.' : undefined}
                        type="button"
                      >
                        {characterName}
                      </button>
                    )
                  })}
                </div>

                {!isConfusedAvailableInManualDeck ? (
                  <p className={`character-pool-hint ${isCharacterPoolInvalid ? 'invalid' : ''}`}>
                    {hasUnavailableConfusedSelection
                      ? isCharacterPoolInvalid
                        ? 'No eligible characters remain. Add J back to the manual deck or select another character.'
                        : 'The Confused is temporarily out of the pool because J is not in the manual deck.'
                      : 'The Confused can only be added when J is included in the manual deck.'}
                  </p>
                ) : null}
              </div>
            ) : null}

            <fieldset className="deck-mode-group">
              <legend>Standard Ranks</legend>

              <div className="deck-mode-options">
                <label className={`deck-mode-option ${rankSelectionMode === 'default' ? 'active' : ''}`}>
                  <input
                    checked={rankSelectionMode === 'default'}
                    name="rank-selection-mode"
                    onChange={() => setRankSelectionMode('default')}
                    type="radio"
                    value="default"
                  />
                  <span className="deck-mode-title-wrap">
                    <span className="deck-mode-title">Default</span>
                    <span aria-hidden="true" className="deck-mode-help">?</span>
                  </span>
                  <span className="deck-mode-tooltip" role="tooltip">{defaultDeckDescription}</span>
                </label>

                <label className={`deck-mode-option ${rankSelectionMode === 'manual' ? 'active' : ''}`}>
                  <input
                    checked={rankSelectionMode === 'manual'}
                    name="rank-selection-mode"
                    onChange={() => setRankSelectionMode('manual')}
                    type="radio"
                    value="manual"
                  />
                  <span className="deck-mode-title-wrap">
                    <span className="deck-mode-title">Manual</span>
                    <span aria-hidden="true" className="deck-mode-help">?</span>
                  </span>
                  <span className="deck-mode-tooltip" role="tooltip">
                    Pick the exact standard ranks yourself. The 2 Jokers are always included.
                  </span>
                </label>
              </div>
            </fieldset>

            {rankSelectionMode === 'manual' ? (
              <div className="manual-rank-panel">
                <div className="manual-rank-header">
                  <div>
                    <p className="panel-kicker">Manual Deck</p>
                    <h3>Choose The Standard Ranks</h3>
                  </div>
                  <span className={`rank-selection-count ${isManualRankSelectionInvalid ? 'invalid' : ''}`}>
                    {manualSelectedRanks.length} selected
                  </span>
                </div>

                <div className="rank-chip-grid">
                  {BLOW_COW_RANKS.map((rank) => {
                    const isSelected = manualSelectedRanks.includes(rank)

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`rank-chip ${isSelected ? 'selected' : ''}`}
                        disabled={isBusy}
                        key={rank}
                        onClick={() => {
                          toggleManualRank(rank)
                        }}
                        type="button"
                      >
                        {rank}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <button className="primary-button" disabled={isBusy || Boolean(createRoomSetupError)} type="submit">
              {busyAction === 'create' ? 'Creating Room...' : 'Create Room'}
            </button>
          </form>
        </article>

        <article className="panel stack-gap">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Join</p>
              <h2>Enter a Room Code</h2>
            </div>
            <span className="panel-badge">Fast Join</span>
          </div>

          <form className="stack-gap" onSubmit={handleJoinRoom}>
            <label className="field">
              <span>Room Code</span>
              <input
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="Paste a match ID"
                value={roomCode}
              />
            </label>

            <button className="primary-button" disabled={isBusy} type="submit">
              {busyAction === 'join' ? 'Joining Room...' : 'Join Room'}
            </button>
          </form>

          <div className="room-list-header">
            <div>
              <p className="panel-kicker">Open Rooms</p>
              <h2>Available Tables</h2>
            </div>
            <span className="room-count">{sortedMatches.length}</span>
          </div>

          <div className="room-list">
            {sortedMatches.length === 0 ? (
              <div className="empty-room-state">
                <p>No rooms yet.</p>
                <span>Create a table and share the code.</span>
              </div>
            ) : (
              sortedMatches.map((match) => {
                const availableSeats = getAvailableSeatCount(match)
                const rejoinablePlayer = getRejoinableOfflinePlayer(match, trimmedPlayerName)
                const canJoinMatch = availableSeats > 0 || Boolean(rejoinablePlayer)
                const quickJoinLabel = rejoinablePlayer ? 'Rejoin This Room' : 'Join This Room'

                return (
                  <article className="room-card" key={match.matchID}>
                    <div className="room-card-top">
                      <div>
                        <p className="room-label">Room Code</p>
                        <strong className="room-id">{match.matchID}</strong>
                      </div>
                      <span className="seat-pill">
                        {availableSeats} open {availableSeats === 1 ? 'seat' : 'seats'}
                      </span>
                    </div>

                    <div className="seat-row">
                      {match.players.map((player) => (
                        <span
                          className={`seat-chip ${player.name && player.isConnected === false ? 'offline' : ''}`}
                          key={`${match.matchID}-${player.id}`}
                        >
                          P{player.id}: {formatRoomSeatLabel(player)}
                        </span>
                      ))}
                    </div>

                    <div className="room-card-footer">
                      <span>Updated {formatTimestamp(match.updatedAt ?? match.createdAt)}</span>
                      <button
                        className="subtle-button"
                        disabled={isBusy || !canJoinMatch}
                        onClick={() => {
                          void handleQuickJoin(match.matchID)
                        }}
                        type="button"
                      >
                        {quickJoinLabel}
                      </button>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </article>
      </section>
    </main>
  )
}

export default App
