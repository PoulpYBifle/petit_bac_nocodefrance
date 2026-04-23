import { useEffect, useMemo, useState } from 'react'
import './index.css'
import {
  activePlayers,
  categoryLabel,
  createRoom,
  createRound,
  ensureSubmission,
  generateId,
  getRound,
  matchesRoundLetter,
  playerById,
  reassignHost,
  roomShareUrl,
  scoreRound,
} from './lib/game'
import type {
  GameRound,
  Room,
  RoomConfig,
  RoundCount,
  RoundDurationSeconds,
} from './types'

const ROOM_STORAGE_PREFIX = 'petit-bac-room:'
const SESSION_STORAGE_KEY = 'petit-bac-session-id'
const PSEUDO_STORAGE_KEY = 'petit-bac-pseudo'
const channel = new BroadcastChannel('petit-bac-nocode')
const now = () => Date.now()

function getSessionId() {
  const existing = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) {
    return existing
  }
  const created = generateId('session')
  sessionStorage.setItem(SESSION_STORAGE_KEY, created)
  return created
}

function loadRoom(code: string) {
  const raw = localStorage.getItem(`${ROOM_STORAGE_PREFIX}${code}`)
  return raw ? (JSON.parse(raw) as Room) : null
}

function saveRoom(room: Room) {
  localStorage.setItem(`${ROOM_STORAGE_PREFIX}${room.code}`, JSON.stringify(room))
  channel.postMessage({ type: 'room:update', code: room.code })
}

function clearRoomUrl() {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.delete('room')
  window.history.replaceState({}, '', nextUrl)
}

function defaultConfig(): RoomConfig {
  return {
    roundCount: 3,
    roundDurationSeconds: 60,
    maxPlayers: 16,
  }
}

function App() {
  const sessionId = useMemo(() => getSessionId(), [])
  const [nickname, setNickname] = useState(
    localStorage.getItem(PSEUDO_STORAGE_KEY) ?? 'Player',
  )
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [config, setConfig] = useState<RoomConfig>(defaultConfig())
  const [roomCode, setRoomCode] = useState(
    new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '',
  )
  const [room, setRoom] = useState<Room | null>(() =>
    roomCode ? loadRoom(roomCode) : null,
  )
  const [copied, setCopied] = useState(false)
  const [clockMs, setClockMs] = useState(() => now())

  useEffect(() => {
    localStorage.setItem(PSEUDO_STORAGE_KEY, nickname)
  }, [nickname])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!roomCode || event.key !== `${ROOM_STORAGE_PREFIX}${roomCode}`) {
        return
      }
      setRoom(loadRoom(roomCode))
    }

    const onMessage = (event: MessageEvent<{ type: string; code: string }>) => {
      if (event.data.type === 'room:update' && event.data.code === roomCode) {
        setRoom(loadRoom(roomCode))
      }
    }

    window.addEventListener('storage', onStorage)
    channel.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('storage', onStorage)
      channel.removeEventListener('message', onMessage)
    }
  }, [roomCode])

  useEffect(() => {
    if (!roomCode) {
      clearRoomUrl()
      return
    }
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set('room', roomCode)
    window.history.replaceState({}, '', nextUrl)
  }, [roomCode])

  useEffect(() => {
    if (!roomCode) {
      return
    }

    const heartbeat = window.setInterval(() => {
      const latest = loadRoom(roomCode)
      if (!latest) {
        return
      }
      const player = latest.players.find((entry) => entry.sessionId === sessionId)
      if (!player) {
        return
      }
      player.lastSeenAt = now()
      reassignHost(latest)
      saveRoom({ ...latest, updatedAt: now() })
      setRoom(latest)
    }, 5000)

    return () => window.clearInterval(heartbeat)
  }, [roomCode, sessionId])

  useEffect(() => {
    if (!room) {
      return
    }
    const currentRound = getRound(room)
    if (!currentRound || currentRound.status !== 'playing') {
      return
    }

    const interval = window.setInterval(() => {
      const latest = loadRoom(room.code)
      if (!latest) {
        return
      }
      const round = getRound(latest)
      if (!round || round.status !== 'playing') {
        return
      }
      if (now() >= round.endsAt) {
        for (const player of latest.players) {
          const submission = ensureSubmission(round, player.id)
          if (!submission.submittedAt) {
            submission.submittedAt = now()
          }
        }
        latest.status = 'review'
        round.status = 'review'
        latest.updatedAt = now()
        saveRoom(latest)
        setRoom(latest)
      }
    }, 1000)

    return () => window.clearInterval(interval)
  }, [room])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockMs(now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

  const me = room?.players.find((player) => player.sessionId === sessionId) ?? null
  const isHost = me?.id === room?.hostPlayerId
  const currentRound = room ? getRound(room) : null
  const currentSubmission =
    room && me && currentRound ? currentRound.submissions[me.id] ?? null : null
  const playersOnline = room ? activePlayers(room) : []

  function updateRoom(mutator: (draft: Room) => void) {
    if (!room) {
      return
    }
    const draft = structuredClone(room)
    mutator(draft)
    draft.updatedAt = now()
    reassignHost(draft)
    saveRoom(draft)
    setRoom(draft)
  }

  function ensureMembership(nextRoom: Room) {
    const existingPlayer = nextRoom.players.find((player) => player.sessionId === sessionId)
    if (existingPlayer) {
      existingPlayer.nickname = nickname.trim() || existingPlayer.nickname
      existingPlayer.lastSeenAt = now()
      saveRoom(nextRoom)
      setRoom(nextRoom)
      return
    }

    if (nextRoom.players.length >= nextRoom.config.maxPlayers) {
      return
    }

    nextRoom.players.push({
      id: generateId('player'),
      sessionId,
      nickname: nickname.trim() || 'Player',
      scoreTotal: 0,
      ready: false,
      joinedAt: now(),
      lastSeenAt: now(),
    })
    saveRoom(nextRoom)
    setRoom(nextRoom)
  }

  function handleCreateRoom() {
    const created = createRoom(config, sessionId, nickname.trim() || 'Player')
    setRoomCode(created.code)
    saveRoom(created)
    setRoom(created)
  }

  function handleJoinRoom() {
    const code = joinCodeInput.trim().toUpperCase()
    if (!code) {
      return
    }
    const existing = loadRoom(code)
    if (!existing) {
      return
    }
    ensureMembership(existing)
    setRoomCode(code)
  }

  function handleLeaveRoom() {
    if (!room) {
      setRoomCode('')
      setRoom(null)
      clearRoomUrl()
      return
    }

    const draft = structuredClone(room)
    const leavingPlayer = draft.players.find((player) => player.sessionId === sessionId)

    if (leavingPlayer) {
      draft.players = draft.players.filter((player) => player.id !== leavingPlayer.id)

      for (const round of draft.rounds) {
        delete round.submissions[leavingPlayer.id]
        delete round.votes[leavingPlayer.id]
        for (const targetVotes of Object.values(round.votes)) {
          for (const categoryVotes of Object.values(targetVotes)) {
            delete categoryVotes[leavingPlayer.id]
          }
        }
        round.scoreDetails = round.scoreDetails.filter(
          (detail) => detail.playerId !== leavingPlayer.id,
        )
      }
    }

    reassignHost(draft)
    draft.updatedAt = now()

    if (draft.players.length === 0) {
      localStorage.removeItem(`${ROOM_STORAGE_PREFIX}${room.code}`)
      channel.postMessage({ type: 'room:update', code: room.code })
    } else {
      saveRoom(draft)
    }

    setRoom(null)
    setRoomCode('')
    setCopied(false)
    clearRoomUrl()
  }

  function handleToggleReady() {
    updateRoom((draft) => {
      const player = draft.players.find((entry) => entry.sessionId === sessionId)
      if (player) {
        player.ready = !player.ready
      }
    })
  }

  function handleRename(nextNickname: string) {
    setNickname(nextNickname)
    updateRoom((draft) => {
      const player = draft.players.find((entry) => entry.sessionId === sessionId)
      if (player) {
        player.nickname = nextNickname.trim() || 'Player'
      }
    })
  }

  function handleStartGame() {
    updateRoom((draft) => {
      if (draft.status !== 'lobby') {
        return
      }
      const firstRound = createRound(draft, 0)
      draft.status = 'playing'
      draft.currentRoundIndex = 0
      draft.usedLetters = [firstRound.letter]
      draft.usedCategoryIds = [...firstRound.categoryIds]
      draft.rounds = [firstRound]
      draft.players.forEach((player) => {
        player.scoreTotal = 0
      })
    })
  }

  function updateAnswer(categoryId: string, value: string) {
    updateRoom((draft) => {
      const player = draft.players.find((entry) => entry.sessionId === sessionId)
      const round = getRound(draft)
      if (!player || !round) {
        return
      }
      const submission = ensureSubmission(round, player.id)
      submission.answers[categoryId] = value
    })
  }

  function handleSubmitRound() {
    updateRoom((draft) => {
      const player = draft.players.find((entry) => entry.sessionId === sessionId)
      const round = getRound(draft)
      if (!player || !round) {
        return
      }
      const submission = ensureSubmission(round, player.id)
      submission.submittedAt = now()

      const everyoneSubmitted = draft.players.every((entry) => {
        const candidate = ensureSubmission(round, entry.id)
        return Boolean(candidate.submittedAt)
      })

      if (everyoneSubmitted) {
        draft.status = 'review'
        round.status = 'review'
      }
    })
  }

  function recordVote(targetPlayerId: string, categoryId: string, approved: boolean) {
    updateRoom((draft) => {
      const voter = draft.players.find((entry) => entry.sessionId === sessionId)
      const round = getRound(draft)
      if (!voter || !round || voter.id === targetPlayerId) {
        return
      }
      round.votes[targetPlayerId] ??= {}
      round.votes[targetPlayerId][categoryId] ??= {}
      round.votes[targetPlayerId][categoryId][voter.id] = approved
    })
  }

  function canFinalizeReview(round: GameRound) {
    const participantIds = room?.players.map((player) => player.id) ?? []
    return participantIds.every((targetPlayerId) =>
      round.categoryIds.every((categoryId) =>
        participantIds
          .filter((voterId) => voterId !== targetPlayerId)
          .every(
            (voterId) =>
              typeof round.votes[targetPlayerId]?.[categoryId]?.[voterId] === 'boolean',
          ),
      ),
    )
  }

  function handleFinalizeReview() {
    updateRoom((draft) => {
      const round = getRound(draft)
      if (!round) {
        return
      }
      scoreRound(draft, round)

      const isLastRound = draft.currentRoundIndex >= draft.config.roundCount - 1
      if (isLastRound) {
        draft.status = 'finished'
        return
      }

      draft.status = 'results'
    })
  }

  function handleNextRound() {
    updateRoom((draft) => {
      const nextIndex = draft.currentRoundIndex + 1
      const round = createRound(draft, nextIndex)
      draft.currentRoundIndex = nextIndex
      draft.status = 'playing'
      draft.usedLetters.push(round.letter)
      draft.usedCategoryIds.push(...round.categoryIds)
      draft.rounds.push(round)
    })
  }

  const shareUrl = room ? roomShareUrl(room.code) : ''
  const secondsLeft = currentRound
    ? Math.max(0, Math.ceil((currentRound.endsAt - clockMs) / 1000))
    : 0

  async function copyInviteLink() {
    if (!shareUrl) {
      return
    }
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (!room || !me) {
    return (
      <main className="app-shell">
        <section className="hero-panel">
          <img src="/logo-triline.png" alt="Petit Bac No-Code France" className="hero-corner-logo" />
          <div className="brand-lockup">
            <div className="brand-copy">
              <h1>Petit Bac multiplayer pour builders du web</h1>
              <p className="hero-copy">
                Cree une room sans compte, invite jusqu a 16 joueurs et enchaine des
                rounds dev, no-code et culture web en temps reel.
              </p>
            </div>
          </div>

          <div className="hero-grid">
            <article className="surface card">
              <span className="section-kicker">Creer une room</span>
              <label>
                Pseudo
                <input value={nickname} onChange={(event) => setNickname(event.target.value)} />
              </label>
              <div className="option-group">
                <span>Rounds</span>
                <div className="chip-row">
                  {[1, 3, 5, 7].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={config.roundCount === value ? 'chip active' : 'chip'}
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          roundCount: value as RoundCount,
                        }))
                      }
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="option-group">
                <span>Timer</span>
                <div className="chip-row">
                  {[30, 60, 120, 180].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        config.roundDurationSeconds === value ? 'chip active' : 'chip'
                      }
                      onClick={() =>
                        setConfig((current) => ({
                          ...current,
                          roundDurationSeconds: value as RoundDurationSeconds,
                        }))
                      }
                    >
                      {value}s
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="cta" onClick={handleCreateRoom}>
                Creer une room
              </button>
            </article>

            <article className="surface card card-dark">
              <span className="section-kicker">Rejoindre</span>
              <label>
                Code room
                <input
                  value={joinCodeInput}
                  onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
              </label>
              <button type="button" className="secondary" onClick={handleJoinRoom}>
                Rejoindre la room
              </button>
              <ul className="bullet-list">
                <li>Acces anonyme par lien ou code</li>
                <li>6 categories par round, sans repetition inutile</li>
                <li>Votes joueurs pour arbitrer les reponses</li>
              </ul>
            </article>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Room {room.code}</span>
          <h1>Petit Bac No-Code France</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={handleLeaveRoom}>
            Retour accueil
          </button>
          <button type="button" className="danger" onClick={handleLeaveRoom}>
            Quitter la room
          </button>
          <button type="button" className="secondary" onClick={copyInviteLink}>
            {copied ? 'Lien copie' : 'Copier le lien'}
          </button>
          <span className="status-pill">{room.status}</span>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="surface sidebar">
          <div className="sidebar-block">
            <span className="section-kicker">Configuration</span>
            <p>{room.config.roundCount} rounds</p>
            <p>{room.config.roundDurationSeconds}s par round</p>
            <p>{room.config.maxPlayers} joueurs max</p>
          </div>

          <div className="sidebar-block">
            <span className="section-kicker">Joueurs</span>
            <ul className="player-list">
              {room.players.map((player) => {
                const online = playersOnline.some((entry) => entry.id === player.id)
                return (
                  <li key={player.id} className="player-row">
                    <div>
                      <strong>{player.nickname}</strong>
                      <span>
                        {player.id === room.hostPlayerId ? 'Hote' : 'Participant'}
                        {' · '}
                        {online ? 'Connecte' : 'Absent'}
                      </span>
                    </div>
                    <div className="player-meta">
                      <span>{player.ready ? 'Pret' : 'En attente'}</span>
                      <strong>{player.scoreTotal} pts</strong>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="sidebar-block">
            <label>
              Mon pseudo
              <input value={nickname} onChange={(event) => handleRename(event.target.value)} />
            </label>
            {room.status === 'lobby' ? (
              <button type="button" className="secondary" onClick={handleToggleReady}>
                {me.ready ? 'Annuler pret' : 'Je suis pret'}
              </button>
            ) : null}
          </div>
        </aside>

        <section className="main-stage">
          {room.status === 'lobby' ? (
            <section className="surface stage-card">
              <span className="section-kicker">Lobby</span>
              <h2>Invite l equipe et lance la partie</h2>
              <p>
                Le MVP local synchronise la room entre onglets et navigateurs du meme poste.
                La structure est prete pour etre branchee a Convex ensuite.
              </p>
              <div className="share-box">
                <code>{shareUrl}</code>
              </div>
              <div className="cta-row">
                <button type="button" className="secondary" onClick={handleToggleReady}>
                  {me.ready ? 'Retirer mon pret' : 'Je suis pret'}
                </button>
                <button
                  type="button"
                  className="cta"
                  disabled={!isHost || room.players.length < 1}
                  onClick={handleStartGame}
                >
                  {isHost ? 'Demarrer la partie' : 'Seul l hote peut lancer'}
                </button>
                <button type="button" className="ghost" onClick={handleLeaveRoom}>
                  Annuler et revenir a l accueil
                </button>
              </div>
            </section>
          ) : null}

          {room.status === 'playing' && currentRound ? (
            <section className="surface stage-card">
              <div className="round-head">
                <div>
                  <span className="section-kicker">
                    Round {currentRound.index + 1} / {room.config.roundCount}
                  </span>
                  <h2>Lettre {currentRound.letter}</h2>
                </div>
                <div className="timer-box">{secondsLeft}s</div>
              </div>
              <div className="answer-grid">
                {currentRound.categoryIds.map((categoryId) => {
                  const value = currentSubmission?.answers[categoryId] ?? ''
                  const matches = value === '' || matchesRoundLetter(value, currentRound.letter)
                  return (
                    <label key={categoryId} className={matches ? 'answer-card' : 'answer-card invalid'}>
                      <span>{categoryLabel(categoryId)}</span>
                      <input
                        value={value}
                        onChange={(event) => updateAnswer(categoryId, event.target.value)}
                        placeholder={`${currentRound.letter}...`}
                      />
                    </label>
                  )
                })}
              </div>
              <div className="cta-row">
                <button type="button" className="cta" onClick={handleSubmitRound}>
                  Soumettre mes reponses
                </button>
                <button type="button" className="ghost" onClick={handleLeaveRoom}>
                  Quitter la partie
                </button>
                <p className="microcopy">Auto-submit a la fin du chrono.</p>
              </div>
            </section>
          ) : null}

          {room.status === 'review' && currentRound ? (
            <section className="surface stage-card">
              <div className="round-head">
                <div>
                  <span className="section-kicker">Phase de vote</span>
                  <h2>Valide les reponses des autres joueurs</h2>
                </div>
                <div className="timer-box timer-review">
                  {canFinalizeReview(currentRound) ? 'Complet' : 'En cours'}
                </div>
              </div>
              <div className="vote-stack">
                {room.players
                  .filter((player) => player.id !== me.id)
                  .map((player) => {
                    const submission = currentRound.submissions[player.id]
                    return (
                      <article key={player.id} className="vote-card">
                        <header>
                          <strong>{player.nickname}</strong>
                          <span>{player.scoreTotal} pts</span>
                        </header>
                        <div className="vote-grid">
                          {currentRound.categoryIds.map((categoryId) => {
                            const answer = submission?.answers[categoryId] ?? ''
                            const myVote =
                              currentRound.votes[player.id]?.[categoryId]?.[me.id]
                            return (
                              <div key={categoryId} className="vote-line">
                                <div>
                                  <span>{categoryLabel(categoryId)}</span>
                                  <strong>{answer || 'Vide'}</strong>
                                </div>
                                <div className="chip-row">
                                  <button
                                    type="button"
                                    className={myVote === true ? 'chip active' : 'chip'}
                                    onClick={() => recordVote(player.id, categoryId, true)}
                                  >
                                    Valide
                                  </button>
                                  <button
                                    type="button"
                                    className={myVote === false ? 'chip active alt' : 'chip alt'}
                                    onClick={() => recordVote(player.id, categoryId, false)}
                                  >
                                    Refuse
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </article>
                    )
                  })}
              </div>
              <div className="cta-row">
                <button
                  type="button"
                  className="cta"
                  disabled={!isHost || !canFinalizeReview(currentRound)}
                  onClick={handleFinalizeReview}
                >
                  {isHost ? 'Calculer les scores' : 'Attente de l hote'}
                </button>
                <button type="button" className="ghost" onClick={handleLeaveRoom}>
                  Quitter la partie
                </button>
              </div>
            </section>
          ) : null}

          {(room.status === 'results' || room.status === 'finished') && currentRound ? (
            <section className="surface stage-card">
              <span className="section-kicker">
                {room.status === 'finished' ? 'Classement final' : 'Scoreboard'}
              </span>
              <h2>Resultats du round {currentRound.index + 1}</h2>
              <div className="results-grid">
                <div className="surface inner-card">
                  <h3>Classement</h3>
                  <ol className="score-list">
                    {[...room.players]
                      .sort((left, right) => right.scoreTotal - left.scoreTotal)
                      .map((player) => (
                        <li key={player.id}>
                          <span>{player.nickname}</span>
                          <strong>{player.scoreTotal} pts</strong>
                        </li>
                      ))}
                  </ol>
                </div>
                <div className="surface inner-card">
                  <h3>Detail du round</h3>
                  <div className="results-lines">
                    {currentRound.scoreDetails.map((detail) => (
                      <div key={`${detail.playerId}-${detail.categoryId}`} className="result-line">
                        <span>
                          {playerById(room.players, detail.playerId)?.nickname} ·{' '}
                          {categoryLabel(detail.categoryId)}
                        </span>
                        <strong>
                          {detail.answer || 'Vide'} · {detail.points} pts
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="cta-row">
                {room.status !== 'finished' ? (
                  <>
                    <button
                      type="button"
                      className="cta"
                      disabled={!isHost}
                      onClick={handleNextRound}
                    >
                      {isHost ? 'Lancer le round suivant' : 'Attente de l hote'}
                    </button>
                    <button type="button" className="ghost" onClick={handleLeaveRoom}>
                      Retour accueil
                    </button>
                  </>
                ) : (
                  <button type="button" className="cta" onClick={handleLeaveRoom}>
                    Revenir a l accueil
                  </button>
                )}
              </div>
            </section>
          ) : null}
        </section>
      </section>
    </main>
  )
}

export default App
