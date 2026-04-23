import { CATEGORY_CATALOG } from '../data/categories'
import type {
  GameRound,
  Player,
  Room,
  RoomConfig,
  RoundScoreDetail,
} from '../types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('')
}

export function normalizeAnswer(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

export function matchesRoundLetter(value: string, letter: string) {
  return normalizeAnswer(value).startsWith(letter.toLowerCase())
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

export function createRoom(config: RoomConfig, hostSessionId: string, nickname: string): Room {
  const hostPlayerId = generateId('player')
  const now = Date.now()
  return {
    id: generateId('room'),
    code: generateRoomCode(),
    hostPlayerId,
    status: 'lobby',
    config,
    createdAt: now,
    updatedAt: now,
    currentRoundIndex: 0,
    usedLetters: [],
    usedCategoryIds: [],
    rounds: [],
    players: [
      {
        id: hostPlayerId,
        sessionId: hostSessionId,
        nickname,
        scoreTotal: 0,
        ready: false,
        joinedAt: now,
        lastSeenAt: now,
      },
    ],
  }
}

export function listAvailableLetters(room: Room) {
  return LETTERS.filter((letter) => !room.usedLetters.includes(letter))
}

export function pickCategories(room: Room, count: number) {
  const available = CATEGORY_CATALOG.filter(
    (category) => !room.usedCategoryIds.includes(category.id),
  )
  const pool = available.length >= count ? available : CATEGORY_CATALOG
  return shuffle(pool)
    .slice(0, count)
    .map((category) => category.id)
}

export function createRound(room: Room, index: number): GameRound {
  const letters = listAvailableLetters(room)
  const letterPool = letters.length > 0 ? letters : LETTERS
  const letter = shuffle(letterPool)[0]
  const categoryIds = pickCategories(room, 6)
  const startedAt = Date.now()
  const endsAt = startedAt + room.config.roundDurationSeconds * 1000

  return {
    id: generateId('round'),
    index,
    letter,
    categoryIds,
    startedAt,
    endsAt,
    status: 'playing',
    submissions: {},
    votes: {},
    scoreDetails: [],
  }
}

export function ensureSubmission(round: GameRound, playerId: string) {
  if (!round.submissions[playerId]) {
    round.submissions[playerId] = {
      playerId,
      answers: {},
      submittedAt: null,
    }
  }
  return round.submissions[playerId]
}

export function getRound(room: Room) {
  return room.rounds[room.currentRoundIndex] ?? null
}

export function activePlayers(room: Room, now = Date.now()) {
  return room.players.filter((player) => now - player.lastSeenAt < 20_000)
}

export function reassignHost(room: Room) {
  const candidates = activePlayers(room)
  if (candidates.some((player) => player.id === room.hostPlayerId)) {
    return
  }
  const nextHost = [...candidates].sort((left, right) => left.joinedAt - right.joinedAt)[0]
  if (nextHost) {
    room.hostPlayerId = nextHost.id
  }
}

export function scoreRound(room: Room, round: GameRound) {
  const players = room.players
  const categoryIds = round.categoryIds
  const details: RoundScoreDetail[] = []

  for (const player of players) {
      const submission = round.submissions[player.id]
      if (!submission) {
        continue
      }

      for (const categoryId of categoryIds) {
        const answer = submission.answers[categoryId]?.trim() ?? ''
        const valid =
          answer !== '' &&
          matchesRoundLetter(answer, round.letter) &&
          isAnswerValid(round, player.id, categoryId)
        const normalized = normalizeAnswer(answer)

      let duplicate = false
      if (valid) {
        duplicate = players.some((otherPlayer) => {
          if (otherPlayer.id === player.id) {
            return false
          }
          const otherAnswer =
            round.submissions[otherPlayer.id]?.answers[categoryId]?.trim() ?? ''
          return (
            otherAnswer !== '' &&
            isAnswerValid(round, otherPlayer.id, categoryId) &&
            normalizeAnswer(otherAnswer) === normalized
          )
        })
      }

      details.push({
        playerId: player.id,
        categoryId,
        answer,
        valid,
        duplicate,
        points: !valid ? 0 : duplicate ? 5 : 10,
      })
    }
  }

  for (const player of players) {
    const nextScore = details
      .filter((detail) => detail.playerId === player.id)
      .reduce((sum, detail) => sum + detail.points, 0)
    const previousRoundsScore = room.rounds
      .filter((candidate) => candidate.id !== round.id)
      .flatMap((candidate) => candidate.scoreDetails)
      .filter((detail) => detail.playerId === player.id)
      .reduce((sum, detail) => sum + detail.points, 0)

    player.scoreTotal = previousRoundsScore + nextScore
  }

  round.scoreDetails = details
  round.status = 'scored'
}

export function isAnswerValid(round: GameRound, playerId: string, categoryId: string) {
  const voterMap = round.votes[playerId]?.[categoryId] ?? {}
  const voteEntries = Object.values(voterMap)
  if (voteEntries.length === 0) {
    return true
  }
  const approvals = voteEntries.filter(Boolean).length
  const rejections = voteEntries.length - approvals
  return approvals >= rejections
}

export function roomShareUrl(code: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', code)
  return url.toString()
}

export function categoryLabel(categoryId: string) {
  return (
    CATEGORY_CATALOG.find((category) => category.id === categoryId)?.label ?? categoryId
  )
}

export function playerById(players: Player[], playerId: string) {
  return players.find((player) => player.id === playerId) ?? null
}
