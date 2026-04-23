export type RoomStatus = 'lobby' | 'playing' | 'review' | 'results' | 'finished'

export type RoundStatus = 'playing' | 'review' | 'scored'

export type RoundCount = 1 | 3 | 5 | 7

export type RoundDurationSeconds = 30 | 60 | 120 | 180

export interface RoomConfig {
  roundCount: RoundCount
  roundDurationSeconds: RoundDurationSeconds
  maxPlayers: 16
}

export interface Player {
  id: string
  sessionId: string
  nickname: string
  scoreTotal: number
  ready: boolean
  joinedAt: number
  lastSeenAt: number
}

export interface RoundSubmission {
  playerId: string
  answers: Record<string, string>
  submittedAt: number | null
}

export interface VoteMap {
  [voterId: string]: boolean
}

export interface RoundVotes {
  [playerId: string]: {
    [categoryId: string]: VoteMap
  }
}

export interface RoundScoreDetail {
  playerId: string
  categoryId: string
  answer: string
  valid: boolean
  duplicate: boolean
  points: number
}

export interface GameRound {
  id: string
  index: number
  letter: string
  categoryIds: string[]
  startedAt: number
  endsAt: number
  status: RoundStatus
  submissions: Record<string, RoundSubmission>
  votes: RoundVotes
  scoreDetails: RoundScoreDetail[]
}

export interface Room {
  id: string
  code: string
  hostPlayerId: string
  status: RoomStatus
  config: RoomConfig
  createdAt: number
  updatedAt: number
  players: Player[]
  rounds: GameRound[]
  currentRoundIndex: number
  usedLetters: string[]
  usedCategoryIds: string[]
}

export interface Category {
  id: string
  label: string
}
