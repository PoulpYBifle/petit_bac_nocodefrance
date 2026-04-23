import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import './index.css'
import { api } from '../convex/_generated/api'
import { activePlayers, categoryLabel, generateId, matchesRoundLetter, playerById, roomShareUrl } from './lib/game'
import type { GameRound, Player, Room, RoomConfig, RoundCount, RoundDurationSeconds } from './types'

const SESSION_STORAGE_KEY = 'petit-bac-session-id'
const PSEUDO_STORAGE_KEY = 'petit-bac-pseudo'
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
  const [copied, setCopied] = useState(false)
  const [clockMs, setClockMs] = useState(() => now())
  const [joinError, setJoinError] = useState('')
  const [draftState, setDraftState] = useState<{
    roundId: string | null
    answers: Record<string, string>
  }>({
    roundId: null,
    answers: {},
  })
  const autoJoinCodeRef = useRef('')

  const roomView = useQuery(api.game.getGameRoomByCode, roomCode ? { code: roomCode } : 'skip') as
    | Room
    | null
    | undefined

  const createSharedRoom = useMutation(api.lobby.createRoom)
  const joinSharedRoom = useMutation(api.lobby.joinRoom)
  const setSharedReady = useMutation(api.lobby.setReady)
  const renameSharedPlayer = useMutation(api.lobby.renamePlayer)
  const sharedHeartbeat = useMutation(api.lobby.heartbeat)
  const leaveSharedRoom = useMutation(api.lobby.leaveRoom)
  const kickSharedPlayer = useMutation(api.lobby.kickPlayer)

  const startSharedGame = useMutation(api.game.startGame)
  const saveSharedAnswers = useMutation(api.game.saveAnswers)
  const forceEndSharedRound = useMutation(api.game.forceEndRound)
  const voteSharedAnswer = useMutation(api.game.voteAnswer)
  const finalizeSharedReview = useMutation(api.game.finalizeReview)
  const startSharedNextRound = useMutation(api.game.startNextRound)

  useEffect(() => {
    localStorage.setItem(PSEUDO_STORAGE_KEY, nickname)
  }, [nickname])

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
    if (!roomCode || autoJoinCodeRef.current === roomCode) {
      return
    }

    let canceled = false
    autoJoinCodeRef.current = roomCode
    joinSharedRoom({
      code: roomCode,
      sessionId,
      nickname: nickname.trim() || 'Player',
    })
      .then(() => {
        if (!canceled) {
          setJoinError('')
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setJoinError(error instanceof Error ? error.message : 'Impossible de rejoindre la room')
        }
      })

    return () => {
      canceled = true
    }
  }, [joinSharedRoom, nickname, roomCode, sessionId])

  useEffect(() => {
    if (!roomCode) {
      return
    }
    const heartbeat = window.setInterval(() => {
      void sharedHeartbeat({ code: roomCode, sessionId })
    }, 5000)

    return () => window.clearInterval(heartbeat)
  }, [roomCode, sessionId, sharedHeartbeat])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockMs(now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

  const me = roomView?.players.find((player: Player) => player.sessionId === sessionId) ?? null
  const isHost = me?.id === roomView?.hostPlayerId
  const currentRound = roomView ? roomView.rounds[roomView.currentRoundIndex] ?? null : null
  const currentSubmission =
    roomView && me && currentRound ? currentRound.submissions[me.id] ?? null : null
  const playersOnline = roomView ? activePlayers(roomView) : []
  const draftAnswers =
    currentRound && draftState.roundId === currentRound.id
      ? draftState.answers
      : (currentSubmission?.answers ?? {})

  useEffect(() => {
    if (!roomCode || !roomView || roomView.status !== 'playing' || !currentRound) {
      return
    }
    if (Date.now() >= currentRound.endsAt) {
      void forceEndSharedRound({ code: roomCode })
    }
  }, [currentRound, forceEndSharedRound, roomCode, roomView, clockMs])

  async function handleCreateRoom() {
    const created = await createSharedRoom({
      config,
      sessionId,
      nickname: nickname.trim() || 'Player',
    })
    setJoinError('')
    autoJoinCodeRef.current = ''
    setRoomCode(created.code)
  }

  function handleJoinRoom() {
    const code = joinCodeInput.trim().toUpperCase()
    if (!code) {
      return
    }
    setJoinError('')
    autoJoinCodeRef.current = ''
    setRoomCode(code)
  }

  async function handleLeaveRoom() {
    if (roomCode) {
      await leaveSharedRoom({ code: roomCode, sessionId })
    }
    setRoomCode('')
    setJoinCodeInput('')
    setCopied(false)
    autoJoinCodeRef.current = ''
    clearRoomUrl()
  }

  function handleToggleReady() {
    if (!roomCode || !me) {
      return
    }
    void setSharedReady({ code: roomCode, sessionId, ready: !me.ready })
  }

  function handleRename(nextNickname: string) {
    setNickname(nextNickname)
    if (!roomCode) {
      return
    }
    void renameSharedPlayer({
      code: roomCode,
      sessionId,
      nickname: nextNickname.trim() || 'Player',
    })
  }

  function handleKickPlayer(targetSessionId: string) {
    if (!roomCode || !isHost) {
      return
    }
    void kickSharedPlayer({
      code: roomCode,
      hostSessionId: sessionId,
      targetSessionId,
    })
  }

  function handleStartGame() {
    if (!roomCode || !isHost) {
      return
    }
    void startSharedGame({ code: roomCode, hostSessionId: sessionId })
  }

  function updateAnswer(categoryId: string, value: string) {
    const baseAnswers =
      currentRound && draftState.roundId === currentRound.id
        ? draftState.answers
        : (currentSubmission?.answers ?? {})
    const next = { ...baseAnswers, [categoryId]: value }
    setDraftState({
      roundId: currentRound?.id ?? null,
      answers: next,
    })
    if (roomCode) {
      void saveSharedAnswers({
        code: roomCode,
        sessionId,
        answers: { [categoryId]: value },
        submit: false,
      })
    }
  }

  function handleSubmitRound() {
    if (!roomCode) {
      return
    }
    const answers =
      currentRound && draftState.roundId === currentRound.id
        ? draftState.answers
        : draftAnswers
    void saveSharedAnswers({
      code: roomCode,
      sessionId,
      answers,
      submit: true,
    })
  }

  function recordVote(targetPlayerId: string, categoryId: string, approved: boolean) {
    if (!roomCode || !me) {
      return
    }
    void voteSharedAnswer({
      code: roomCode,
      voterSessionId: sessionId,
      targetPlayerId,
      categoryId,
      approved,
    })
  }

  function canFinalizeReview(round: GameRound) {
    const participantIds = roomView?.players.map((player: Player) => player.id) ?? []
    return participantIds.every((targetPlayerId: string) =>
      round.categoryIds.every((categoryId) =>
        participantIds
          .filter((voterId: string) => voterId !== targetPlayerId)
          .every(
            (voterId: string) =>
              typeof round.votes[targetPlayerId]?.[categoryId]?.[voterId] === 'boolean',
          ),
      ),
    )
  }

  function handleFinalizeReview() {
    if (!roomCode || !isHost) {
      return
    }
    void finalizeSharedReview({ code: roomCode, hostSessionId: sessionId })
  }

  function handleNextRound() {
    if (!roomCode || !isHost) {
      return
    }
    void startSharedNextRound({ code: roomCode, hostSessionId: sessionId })
  }

  const shareUrl = roomView ? roomShareUrl(roomView.code) : ''
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

  if (!roomView || !me) {
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
              {joinError ? <p className="join-error">{joinError}</p> : null}
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
          <span className="eyebrow">Room {roomView.code}</span>
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
          <span className="status-pill">{roomView.status}</span>
        </div>
      </header>

      <section className="dashboard-grid">
        <aside className="surface sidebar">
          <div className="sidebar-block">
            <span className="section-kicker">Configuration</span>
            <p>{roomView.config.roundCount} rounds</p>
            <p>{roomView.config.roundDurationSeconds}s par round</p>
            <p>{roomView.config.maxPlayers} joueurs max</p>
          </div>

          <div className="sidebar-block">
            <span className="section-kicker">Joueurs</span>
            <ul className="player-list">
              {roomView.players.map((player: Player) => {
                const online = playersOnline.some((entry) => entry.id === player.id)
                return (
                  <li key={player.id} className="player-row">
                    <div>
                      <strong>{player.nickname}</strong>
                      <span>
                        {player.id === roomView.hostPlayerId ? 'Hote' : 'Participant'}
                        {' · '}
                        {online ? 'Connecte' : 'Absent'}
                      </span>
                    </div>
                    <div className="player-meta">
                      <span>{player.ready ? 'Pret' : 'En attente'}</span>
                      <strong>{player.scoreTotal} pts</strong>
                      {isHost && player.id !== me.id ? (
                        <button
                          type="button"
                          className={online ? 'player-action' : 'player-action danger'}
                          onClick={() => handleKickPlayer(player.sessionId)}
                        >
                          {online ? 'Retirer' : 'Virer AFK'}
                        </button>
                      ) : null}
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
            {roomView.status === 'lobby' ? (
              <button type="button" className="secondary" onClick={handleToggleReady}>
                {me.ready ? 'Annuler pret' : 'Je suis pret'}
              </button>
            ) : null}
          </div>
        </aside>

        <section className="main-stage">
          {roomView.status === 'lobby' ? (
            <section className="surface stage-card">
              <span className="section-kicker">Lobby</span>
              <h2>Invite l equipe et lance la partie</h2>
              <p>Le lobby et la partie sont maintenant synchronises en temps reel via Convex.</p>
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
                  disabled={!isHost}
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

          {roomView.status === 'playing' && currentRound ? (
            <section className="surface stage-card">
              <div className="round-head">
                <div>
                  <span className="section-kicker">
                    Round {currentRound.index + 1} / {roomView.config.roundCount}
                  </span>
                  <h2>Lettre {currentRound.letter}</h2>
                </div>
                <div className="timer-box">{secondsLeft}s</div>
              </div>
              <div className="answer-grid">
                {currentRound.categoryIds.map((categoryId) => {
                  const value = draftAnswers[categoryId] ?? ''
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

          {roomView.status === 'review' && currentRound ? (
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
                {roomView.players
                  .filter((player: Player) => player.id !== me.id)
                  .map((player: Player) => {
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

          {(roomView.status === 'results' || roomView.status === 'finished') && currentRound ? (
            <section className="surface stage-card">
              <span className="section-kicker">
                {roomView.status === 'finished' ? 'Classement final' : 'Scoreboard'}
              </span>
              <h2>Resultats du round {currentRound.index + 1}</h2>
              <div className="results-grid">
                <div className="surface inner-card">
                  <h3>Classement</h3>
                  <ol className="score-list">
                    {[...roomView.players]
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
                          {playerById(roomView.players, detail.playerId)?.nickname} ·{' '}
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
                {roomView.status !== 'finished' ? (
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
