/**
 * Bot seats, run as headless boardgame.io clients in the host's browser.
 *
 * **Why here rather than on the server.** A bot has to be a *player*: it needs its own seat,
 * credentials, and — critically — its own `playerView`, so it sees exactly the hand a human in that
 * chair would see and nothing more. boardgame.io gives that for free to a client that joined the
 * match, and for nothing at all to code running inside the server, which would have to be handed the
 * unmasked `G` and then be trusted not to look. Running them as clients means the bots are subject to
 * the same authority, the same hidden-information masking, and the same move validation as anybody
 * else; a buggy bot can only ever make a legal move or be refused.
 *
 * **The cost, and it is real:** the bots live in the tab that added them. Close it and they stop
 * playing, though their seats remain and the room survives. That is the trade for not building a bot
 * runtime into the server, and it is stated in the staging UI rather than left to be discovered.
 * `resumeBot` is what stops it being terminal: any player at the table can take an offline bot's
 * seat over and run it from their own browser, which is sound precisely because a bot carries no
 * state between decisions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Client as PlainClient, LobbyClient } from 'boardgame.io/client'
import { SocketIO } from 'boardgame.io/multiplayer'

import {
  BlowCowGame,
  getAnteStartingGold,
  getRoundLimit,
  isAnteMode,
  type BlowCowState,
} from '../game/blowCowGame.ts'
import { GAME_NAME, GAME_SERVER_URL } from '../config.ts'
import { decideBotMove } from './blowCowBotPolicy.ts'
import { decideAnteBotMove } from './ante/anteBotPolicy.ts'
import { loadAnteRoundNet } from './ante/anteWeights.ts'
import type { AnteRoundNet } from './ante/anteNet.ts'
import { getBotKindFromSeatName, getBotSeatName, type BlowCowBotKind } from './blowCowBotTypes.ts'

/**
 * How long a bot waits before acting. Not a throttle — the table is animated, and a bot that moved
 * the instant state changed would land its play under a travel animation that has not finished, so
 * the human sees cards appear from nowhere. It also makes the bots legible to play against.
 */
const BOT_THINK_MS = 900
/** A procedure step is a button press mid-animation, so it wants a shorter, steadier beat. */
const BOT_PROCEDURE_MS = 650

export type BotSeat = {
  playerID: string
  credentials: string
  kind: BlowCowBotKind
  name: string
}

type RunningBot = BotSeat & {
  client: ReturnType<typeof PlainClient>
  unsubscribe: () => void
  timer: ReturnType<typeof setTimeout> | null
  /** The move already sent for this state, so a re-render never sends it twice. */
  lastSentKey: string | null
  /*
   * The round this bot last saw, and the `ctx.turn` it began on.
   *
   * The Ante observation counts turns within the round and rebuilds its recent-event ring by walking
   * turn numbers backwards, and `G` says neither — `hideSecretState` empties `archive` for every
   * client and `history` is prose. One integer, stamped when the round number moves, is the whole
   * fix. A bot started mid-round has neither and `anteObservation.ts` falls back to the round's
   * earliest play, which loses only passes made before it.
   */
  anteRoundNumber: number | null
  anteRoundFirstTurn: number | null
}

const lobbyClient = new LobbyClient({ server: GAME_SERVER_URL })

/**
 * Takes over an offline seat and returns fresh credentials for it.
 *
 * The same `/rejoin` route the lobby uses to put a human back in their own chair, and it is what
 * makes a bot recoverable at all: the credentials a bot joined with live in the tab that added it,
 * so once that tab is gone nothing else can drive that seat. The route's own rules are the whole
 * protection — the name must match and the seat must actually be disconnected — so this can never
 * pull a bot out from under a browser that is still playing it.
 */
async function reclaimBotSeat(matchID: string, playerID: string, playerName: string) {
  const response = await fetch(`${GAME_SERVER_URL}/games/${GAME_NAME}/${matchID}/rejoin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ playerID, playerName }),
  })

  if (!response.ok) {
    throw new Error((await response.text()) || 'Could not take over that bot seat.')
  }

  return await response.json() as { playerID: string; playerCredentials: string }
}

export function useBotSeats(matchID: string | null, numPlayers: number) {
  const [botSeats, setBotSeats] = useState<BotSeat[]>([])
  const [botError, setBotError] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const running = useRef(new Map<string, RunningBot>())
  /** Shared by every Ante bot in this tab: one fetch, one set of weights, several readers. */
  const anteNet = useRef<AnteRoundNet | null>(null)

  const stopBot = useCallback((playerID: string) => {
    const bot = running.current.get(playerID)
    if (!bot) {
      return
    }
    if (bot.timer) {
      clearTimeout(bot.timer)
    }
    bot.unsubscribe()
    bot.client.stop()
    running.current.delete(playerID)
  }, [])

  const stopAllBots = useCallback(() => {
    for (const playerID of [...running.current.keys()]) {
      stopBot(playerID)
    }
  }, [stopBot])

  /*
   * A bot seat belongs to the match it joined, and only to that one.
   *
   * This hook is mounted in `App` rather than in the board, so it outlives any single room — which is
   * what the headless clients need, and is also why the roster has to be torn down on `matchID` rather
   * than on unmount. Without this the seats of every room the host has visited stay listed: their
   * credentials are valid for a match this one is not, so `Remove` answers `403` for every one of
   * them and the list grows a room at a time with nothing able to clear it.
   *
   * The seats are *released* as well as forgotten. Dropping them silently is the same bug wearing a
   * different hat — the old room would go on holding chairs nobody can free. It is best-effort by
   * construction: the room may already have been cleared or swept, and a failure here must not stop
   * the roster being emptied, so nothing is awaited and nothing is surfaced.
   *
   * `running` is the roster rather than a copy of it — `startBot` registers every seat and `stopBot`
   * is the only thing that deletes one — so the credentials are read from there, and this effect is
   * the only cleanup, since a second one running first would empty the map before it could.
   */
  useEffect(() => () => {
    const seats = [...running.current.values()].map(({ playerID, credentials }) => ({
      playerID,
      credentials,
    }))
    stopAllBots()
    setBotSeats([])
    setBotError('')
    if (!matchID) {
      return
    }
    for (const seat of seats) {
      void lobbyClient.leaveMatch(GAME_NAME, matchID, seat).catch(() => {})
    }
  }, [matchID, stopAllBots])

  const startBot = useCallback((seat: BotSeat) => {
    if (!matchID || running.current.has(seat.playerID)) {
      return
    }

    const client = PlainClient({
      game: BlowCowGame,
      matchID,
      playerID: seat.playerID,
      credentials: seat.credentials,
      numPlayers,
      multiplayer: SocketIO({ server: GAME_SERVER_URL }),
      debug: false,
    })

    const entry: RunningBot = {
      ...seat,
      client,
      unsubscribe: () => {},
      timer: null,
      lastSentKey: null,
      anteRoundNumber: null,
      anteRoundFirstTurn: null,
    }

    const tick = () => {
      const snapshot = client.getState()
      if (!snapshot || snapshot.ctx.gameover) {
        return
      }

      const state = snapshot.G as BlowCowState
      const decision = isAnteMode(state)
        ? anteNet.current
          && decideAnteBotMove(
            state,
            snapshot.ctx.currentPlayer,
            seat.playerID,
            anteNet.current,
            entry.anteRoundFirstTurn,
            snapshot.ctx.turn,
          )
        : decideBotMove(state, snapshot.ctx.currentPlayer, seat.playerID, seat.kind)
      if (!decision) {
        return
      }

      /*
       * One move per distinct state. boardgame.io pushes a state update for every change on the
       * table, including ones this bot did not cause, and without this guard a bot would re-send the
       * same move on each of them — harmless, since the server refuses the duplicate, but it would
       * bury the log in rejected moves and make a real bug invisible.
       */
      const key = `${snapshot._stateID}:${decision.move}`
      if (entry.lastSentKey === key) {
        return
      }
      entry.lastSentKey = key

      const dispatch = (client.moves as Record<string, (...args: unknown[]) => void>)[decision.move]
      if (typeof dispatch === 'function') {
        dispatch(...decision.args)
      }
    }

    const schedule = () => {
      if (entry.timer) {
        clearTimeout(entry.timer)
      }
      const snapshot = client.getState()
      const state = snapshot?.G as BlowCowState | undefined

      // Stamped here rather than in the policy, because this runs on every state change while the
      // policy only runs on this seat's turn — and the round can turn over on somebody else's.
      if (state && snapshot && state.round.roundNumber !== entry.anteRoundNumber) {
        entry.anteRoundNumber = state.round.roundNumber
        entry.anteRoundFirstTurn = snapshot.ctx.turn
      }

      const midProcedure = Boolean(
        state && (state.bsResolution || state.resetResolution || state.turnOpening?.reveal),
      )
      entry.timer = setTimeout(tick, midProcedure ? BOT_PROCEDURE_MS : BOT_THINK_MS)
    }

    // The weights are 707KB and only a table that seats one of these ever needs them, so the fetch
    // is started when a bot actually starts rather than on page load. Until it lands the bot simply
    // does not act; a failure leaves it inert rather than making it play badly.
    if (seat.kind === 'agent' && !anteNet.current) {
      // The room's own staged config decides which policy is loaded: the multi-round one when the
      // room matches what that policy was trained at, the one-round one otherwise. Read off this
      // client's own state rather than the lobby, so a rejoin picks the same net the first join did.
      // Both getters supply the defaults for a match staged before their fields existed.
      const staged = client.getState()?.G as BlowCowState | undefined
      loadAnteRoundNet(
        numPlayers,
        getRoundLimit({ roundLimit: staged?.roundLimit }),
        getAnteStartingGold({ startingGold: staged?.startingGold }),
      )
        .then((net) => {
          anteNet.current = net
          schedule()
        })
        .catch((error) => setBotError(
          error instanceof Error ? error.message : 'Could not load the Ante agent.',
        ))
    }

    client.start()
    entry.unsubscribe = client.subscribe(() => schedule())
    running.current.set(seat.playerID, entry)
    schedule()
  }, [matchID, numPlayers])

  const addBot = useCallback(async (kind: BlowCowBotKind) => {
    if (!matchID) {
      return
    }

    setIsBusy(true)
    setBotError('')
    try {
      const name = getBotSeatName(kind, botSeats.length + 1)
      const { playerID, playerCredentials } = await lobbyClient.joinMatch(GAME_NAME, matchID, {
        playerName: name,
      })
      const seat: BotSeat = { playerID, credentials: playerCredentials, kind, name }
      setBotSeats((previous) => [...previous, seat])
      startBot(seat)
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Could not add a bot.')
    } finally {
      setIsBusy(false)
    }
  }, [botSeats.length, matchID, startBot])

  /*
   * Tears a bot's client down and starts a new one on the same seat, with the same credentials.
   *
   * The cheap repair, and the first one to reach for when a bot has stopped moving. It fixes
   * everything that is wrong with the *client* rather than with the seat: a socket that dropped
   * without reconnecting, a stopped subscription, an Ante weight fetch that failed and left the bot
   * inert, and `lastSentKey` still holding a state whose move never landed. It touches no server
   * route, so it cannot fail, cannot cost the seat, and works mid-procedure.
   *
   * What it deliberately cannot fix is a policy that has no move to offer for the state on the table.
   * That bot will sit just as still after the restart, which is the tell: if `Refresh` changes
   * nothing, the bug is in the policy and not in the plumbing.
   */
  const refreshBot = useCallback((playerID: string) => {
    const seat = botSeats.find((candidate) => candidate.playerID === playerID)
    if (!seat) {
      return
    }

    setBotError('')
    stopBot(playerID)
    startBot(seat)
  }, [botSeats, startBot, stopBot])

  /*
   * Kicks a bot off its seat and seats a fresh one of the same kind in it, in one step.
   *
   * The hard reset, for when `refreshBot` was not enough: the seat is left and rejoined, so the new
   * bot arrives with new credentials and the server's own record of the seat — its connection state
   * included — is rebuilt rather than reused.
   *
   * It is one step rather than two on purpose. A seat can be emptied in a match that has already
   * started, but it cannot be *skipped*: the rules have no forfeit, so `G` goes on dealing turns to a
   * chair nobody is in and the table stalls there forever. Leaving and rejoining together is what
   * keeps a kick from being that. If the rejoin half fails the seat really is empty, and the entry is
   * dropped from the roster so the block offers `Seat Bot` rather than pretending it still holds one.
   */
  const replaceBot = useCallback(async (playerID: string) => {
    if (!matchID) {
      return
    }

    const seat = botSeats.find((candidate) => candidate.playerID === playerID)
    if (!seat) {
      return
    }

    setIsBusy(true)
    setBotError('')
    stopBot(playerID)
    try {
      await lobbyClient.leaveMatch(GAME_NAME, matchID, {
        playerID: seat.playerID,
        credentials: seat.credentials,
      })
      const { playerCredentials } = await lobbyClient.joinMatch(GAME_NAME, matchID, {
        playerID: seat.playerID,
        playerName: seat.name,
      })
      const nextSeat: BotSeat = { ...seat, credentials: playerCredentials }
      setBotSeats((previous) => previous.map((candidate) => (
        candidate.playerID === playerID ? nextSeat : candidate
      )))
      startBot(nextSeat)
    } catch (error) {
      setBotSeats((previous) => previous.filter((candidate) => candidate.playerID !== playerID))
      setBotError(error instanceof Error ? error.message : 'Could not replace that bot.')
    } finally {
      setIsBusy(false)
    }
  }, [botSeats, matchID, startBot, stopBot])

  /*
   * Puts a bot in a seat nobody is in.
   *
   * The counterpart to the paragraph above, and the reason a stalled seat is never a dead end: a
   * human who leaves the room mid-match empties their chair exactly the way a kicked bot would, and
   * until now the table simply stopped when the turn reached it. The seat is claimed by `playerID`
   * rather than by whichever one the server hands out, since the whole point is *that* chair.
   *
   * Named off the seat number rather than off a running count, unlike `addBot`: this one can be
   * pressed by any tab at the table, and two of them counting their own rosters would produce two
   * bots with the same name.
   */
  const seatBot = useCallback(async (playerID: string, kind: BlowCowBotKind) => {
    if (!matchID) {
      return
    }

    setIsBusy(true)
    setBotError('')
    stopBot(playerID)
    try {
      const seatNumber = Number.parseInt(playerID, 10)
      const name = getBotSeatName(kind, Number.isNaN(seatNumber) ? 1 : seatNumber + 1)
      const { playerCredentials } = await lobbyClient.joinMatch(GAME_NAME, matchID, {
        playerID,
        playerName: name,
      })
      const seat: BotSeat = { playerID, credentials: playerCredentials, kind, name }
      setBotSeats((previous) => [
        ...previous.filter((candidate) => candidate.playerID !== playerID),
        seat,
      ])
      startBot(seat)
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Could not seat a bot there.')
    } finally {
      setIsBusy(false)
    }
  }, [matchID, startBot, stopBot])

  /*
   * Picks a bot seat back up, from any tab.
   *
   * Bots run in the browser that added them, which is stated in staging rather than hidden — but the
   * consequence used to be terminal: close that tab and the seat sat there forever, and on that
   * seat's turn the whole table waited on a player that no longer exists. Nothing about a bot is
   * worth preserving across that, since the policy is a pure function of the state it is handed and
   * the network holds no memory between decisions, so resuming one is simply starting a fresh client
   * on the seat. The kind is read back off the seat name (`getBotKindFromSeatName`), which is the
   * only thing the departed tab left behind.
   *
   * Deliberately open to every player rather than to the host: the host is the likeliest tab to have
   * gone, and a rule that only they can fix this would leave the ordinary case unfixable.
   */
  const resumeBot = useCallback(async (playerID: string, playerName: string) => {
    if (!matchID) {
      return
    }

    const kind = getBotKindFromSeatName(playerName)
    if (!kind) {
      setBotError(`${playerName} is not a bot seat.`)
      return
    }

    setIsBusy(true)
    setBotError('')
    // Any client this tab still holds for the seat is about to be locked out anyway — `/rejoin`
    // issues new credentials — so it is stopped rather than left running and refused.
    stopBot(playerID)
    try {
      const { playerCredentials } = await reclaimBotSeat(matchID, playerID, playerName)
      const seat: BotSeat = { playerID, credentials: playerCredentials, kind, name: playerName }
      setBotSeats((previous) => [
        ...previous.filter((candidate) => candidate.playerID !== playerID),
        seat,
      ])
      startBot(seat)
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Could not resume that bot.')
    } finally {
      setIsBusy(false)
    }
  }, [matchID, startBot, stopBot])

  const removeBot = useCallback(async (playerID: string) => {
    if (!matchID) {
      return
    }

    const seat = botSeats.find((candidate) => candidate.playerID === playerID)
    if (!seat) {
      return
    }

    setIsBusy(true)
    setBotError('')
    stopBot(playerID)
    try {
      await lobbyClient.leaveMatch(GAME_NAME, matchID, {
        playerID: seat.playerID,
        credentials: seat.credentials,
      })
      setBotSeats((previous) => previous.filter((candidate) => candidate.playerID !== playerID))
    } catch (error) {
      setBotError(error instanceof Error ? error.message : 'Could not remove the bot.')
    } finally {
      setIsBusy(false)
    }
  }, [botSeats, matchID, stopBot])

  return { addBot, botError, botSeats, isBusy, refreshBot, removeBot, replaceBot, resumeBot, seatBot }
}
