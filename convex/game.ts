/* eslint-disable @typescript-eslint/no-explicit-any */
import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { CATEGORY_CATALOG } from '../src/data/categories'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[other]] = [copy[other], copy[index]]
  }
  return copy
}

function normalizeAnswer(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

function matchesRoundLetter(value: string, letter: string) {
  return normalizeAnswer(value).startsWith(letter.toLowerCase())
}

async function getRoomOrThrow(ctx: any, code: string) {
  const room = await ctx.db
    .query('rooms')
    .withIndex('by_code', (q: any) => q.eq('code', code))
    .unique()
  if (!room) {
    throw new Error('Room not found')
  }
  return room
}

async function getPlayersByRoom(ctx: any, roomId: any) {
  const players = await ctx.db
    .query('players')
    .withIndex('by_room', (q: any) => q.eq('roomId', roomId))
    .collect()
  return players.sort((left: any, right: any) => left.joinedAt - right.joinedAt)
}

async function getRoundsByRoom(ctx: any, roomId: any) {
  const rounds = await ctx.db
    .query('rounds')
    .withIndex('by_room', (q: any) => q.eq('roomId', roomId))
    .collect()
  return rounds.sort((left: any, right: any) => left.index - right.index)
}

async function getSubmissionsByRound(ctx: any, roundId: any) {
  return ctx.db.query('submissions').withIndex('by_round', (q: any) => q.eq('roundId', roundId)).collect()
}

async function getVotesByRound(ctx: any, roundId: any) {
  return ctx.db.query('votes').withIndex('by_round', (q: any) => q.eq('roundId', roundId)).collect()
}

function pickLetter(usedLetters: string[]) {
  const available = LETTERS.filter((letter) => !usedLetters.includes(letter))
  const pool = available.length > 0 ? available : LETTERS
  return shuffle(pool)[0]
}

function pickCategories(usedCategoryIds: string[]) {
  const available = CATEGORY_CATALOG.filter((category) => !usedCategoryIds.includes(category.id))
  const pool = available.length >= 6 ? available : CATEGORY_CATALOG
  return shuffle(pool)
    .slice(0, 6)
    .map((category) => category.id)
}

async function createRoundForRoom(ctx: any, room: any, index: number) {
  const letter = pickLetter(room.usedLetters)
  const categoryIds = pickCategories(room.usedCategoryIds)
  const startedAt = Date.now()
  const endsAt = startedAt + room.config.roundDurationSeconds * 1000

  const roundId = await ctx.db.insert('rounds', {
    roomId: room._id,
    index,
    letter,
    categoryIds,
    startedAt,
    endsAt,
    status: 'playing',
    scoreDetails: [],
  })

  await ctx.db.patch(room._id, {
    status: 'playing',
    currentRoundIndex: index,
    usedLetters: [...room.usedLetters, letter],
    usedCategoryIds: [...room.usedCategoryIds, ...categoryIds],
    updatedAt: Date.now(),
  })

  return roundId
}

async function ensureSubmission(ctx: any, roundId: any, playerId: string) {
  const submissions = await getSubmissionsByRound(ctx, roundId)
  const existing = submissions.find((submission: any) => submission.playerId === playerId)
  if (existing) {
    return existing
  }
  const submissionId = await ctx.db.insert('submissions', {
    roundId,
    playerId,
    answers: {},
    submittedAt: null,
  })
  return ctx.db.get(submissionId)
}

function isAnswerValid(votes: any[], playerId: string, categoryId: string) {
  const filtered = votes.filter(
    (vote) => vote.targetPlayerId === playerId && vote.categoryId === categoryId,
  )
  if (filtered.length === 0) {
    return true
  }
  const approvals = filtered.filter((vote) => vote.approved).length
  const rejections = filtered.length - approvals
  return approvals >= rejections
}

async function scoreRound(ctx: any, room: any, round: any) {
  const players = await getPlayersByRoom(ctx, room._id)
  const submissions = await getSubmissionsByRound(ctx, round._id)
  const votes = await getVotesByRound(ctx, round._id)
  const details: Array<{
    playerId: string
    categoryId: string
    answer: string
    valid: boolean
    duplicate: boolean
    points: number
  }> = []

  for (const player of players) {
    const submission = submissions.find((candidate: any) => candidate.playerId === player.sessionId)
    for (const categoryId of round.categoryIds) {
      const answer = submission?.answers?.[categoryId]?.trim() ?? ''
      const valid =
        answer !== '' &&
        matchesRoundLetter(answer, round.letter) &&
        isAnswerValid(votes, player.sessionId, categoryId)
      const normalized = normalizeAnswer(answer)

      let duplicate = false
      if (valid) {
        duplicate = players.some((otherPlayer: any) => {
          if (otherPlayer.sessionId === player.sessionId) {
            return false
          }
          const otherSubmission = submissions.find(
            (candidate: any) => candidate.playerId === otherPlayer.sessionId,
          )
          const otherAnswer = otherSubmission?.answers?.[categoryId]?.trim() ?? ''
          return (
            otherAnswer !== '' &&
            isAnswerValid(votes, otherPlayer.sessionId, categoryId) &&
            normalizeAnswer(otherAnswer) === normalized
          )
        })
      }

      details.push({
        playerId: player.sessionId,
        categoryId,
        answer,
        valid,
        duplicate,
        points: !valid ? 0 : duplicate ? 5 : 10,
      })
    }
  }

  await ctx.db.patch(round._id, {
    status: 'scored',
    scoreDetails: details,
  })

  const previousRounds = await getRoundsByRoom(ctx, room._id)
  for (const player of players) {
    const total = previousRounds
      .flatMap((candidate: any) => (candidate._id === round._id ? details : candidate.scoreDetails))
      .filter((detail: any) => detail.playerId === player.sessionId)
      .reduce((sum: number, detail: any) => sum + detail.points, 0)
    await ctx.db.patch(player._id, { scoreTotal: total })
  }
}

async function advanceIfNeeded(ctx: any, room: any) {
  const rounds = await getRoundsByRoom(ctx, room._id)
  const currentRound = rounds.find((round: any) => round.index === room.currentRoundIndex)
  if (!currentRound) {
    return
  }
  const players = await getPlayersByRoom(ctx, room._id)
  const submissions = await getSubmissionsByRound(ctx, currentRound._id)

  if (currentRound.status === 'playing') {
    const everyoneSubmitted = players.every((player: any) =>
      submissions.some(
        (submission: any) =>
          submission.playerId === player.sessionId && submission.submittedAt !== null,
      ),
    )
    if (everyoneSubmitted || Date.now() >= currentRound.endsAt) {
      for (const player of players) {
        const submission = submissions.find((candidate: any) => candidate.playerId === player.sessionId)
        if (!submission) {
          await ctx.db.insert('submissions', {
            roundId: currentRound._id,
            playerId: player.sessionId,
            answers: {},
            submittedAt: Date.now(),
          })
        } else if (submission.submittedAt === null) {
          await ctx.db.patch(submission._id, { submittedAt: Date.now() })
        }
      }
      await ctx.db.patch(currentRound._id, { status: 'review' })
      await ctx.db.patch(room._id, { status: 'review', updatedAt: Date.now() })
    }
    return
  }

  if (currentRound.status === 'review') {
    await scoreRound(ctx, room, currentRound)
    if (room.currentRoundIndex >= room.config.roundCount - 1) {
      await ctx.db.patch(room._id, { status: 'finished', updatedAt: Date.now() })
    } else {
      await ctx.db.patch(room._id, { status: 'results', updatedAt: Date.now() })
    }
  }
}

export const getGameRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()
    if (!room) {
      return null
    }

    const players = await getPlayersByRoom(ctx, room._id)
    const rounds = await getRoundsByRoom(ctx, room._id)

    const hydratedRounds = []
    for (const round of rounds) {
      const submissions = await getSubmissionsByRound(ctx, round._id)
      const votes = await getVotesByRound(ctx, round._id)

      const submissionMap: Record<string, { playerId: string; answers: Record<string, string>; submittedAt: number | null }> = {}
      for (const submission of submissions) {
        submissionMap[submission.playerId] = {
          playerId: submission.playerId,
          answers: submission.answers,
          submittedAt: submission.submittedAt,
        }
      }

      const voteMap: Record<string, Record<string, Record<string, boolean>>> = {}
      for (const vote of votes) {
        voteMap[vote.targetPlayerId] ??= {}
        voteMap[vote.targetPlayerId][vote.categoryId] ??= {}
        voteMap[vote.targetPlayerId][vote.categoryId][vote.voterPlayerId] = vote.approved
      }

      hydratedRounds.push({
        id: String(round._id),
        index: round.index,
        letter: round.letter,
        categoryIds: round.categoryIds,
        startedAt: round.startedAt,
        endsAt: round.endsAt,
        status: round.status,
        submissions: submissionMap,
        votes: voteMap,
        scoreDetails: round.scoreDetails,
      })
    }

    return {
      id: String(room._id),
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      status: room.status,
      config: room.config,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      currentRoundIndex: room.currentRoundIndex,
      usedLetters: room.usedLetters,
      usedCategoryIds: room.usedCategoryIds,
      players: players.map((player: any) => ({
        id: player.sessionId,
        sessionId: player.sessionId,
        nickname: player.nickname,
        scoreTotal: player.scoreTotal,
        ready: player.ready,
        joinedAt: player.joinedAt,
        lastSeenAt: player.lastSeenAt,
      })),
      rounds: hydratedRounds,
    }
  },
})

export const startGame = mutation({
  args: { code: v.string(), hostSessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    if (room.hostPlayerId !== args.hostSessionId) {
      throw new Error('Only the host can start the game')
    }
    if (room.status !== 'lobby') {
      return
    }
    await createRoundForRoom(ctx, room, 0)
  },
})

export const saveAnswers = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    answers: v.record(v.string(), v.string()),
    submit: v.boolean(),
  },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    const rounds = await getRoundsByRoom(ctx, room._id)
    const currentRound = rounds.find((round: any) => round.index === room.currentRoundIndex)
    if (!currentRound) {
      throw new Error('Round not found')
    }
    const submission = await ensureSubmission(ctx, currentRound._id, args.sessionId)
    await ctx.db.patch(submission._id, {
      answers: { ...submission.answers, ...args.answers },
      submittedAt: args.submit ? Date.now() : submission.submittedAt,
    })
    await advanceIfNeeded(ctx, room)
  },
})

export const forceEndRound = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    await advanceIfNeeded(ctx, room)
  },
})

export const voteAnswer = mutation({
  args: {
    code: v.string(),
    voterSessionId: v.string(),
    targetPlayerId: v.string(),
    categoryId: v.string(),
    approved: v.boolean(),
  },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    const rounds = await getRoundsByRoom(ctx, room._id)
    const currentRound = rounds.find((round: any) => round.index === room.currentRoundIndex)
    if (!currentRound) {
      throw new Error('Round not found')
    }
    const votes = await getVotesByRound(ctx, currentRound._id)
    const existing = votes.find(
      (vote: any) =>
        vote.targetPlayerId === args.targetPlayerId &&
        vote.categoryId === args.categoryId &&
        vote.voterPlayerId === args.voterSessionId,
    )
    if (existing) {
      await ctx.db.patch(existing._id, { approved: args.approved })
    } else {
      await ctx.db.insert('votes', {
        roundId: currentRound._id,
        targetPlayerId: args.targetPlayerId,
        categoryId: args.categoryId,
        voterPlayerId: args.voterSessionId,
        approved: args.approved,
      })
    }
  },
})

export const finalizeReview = mutation({
  args: { code: v.string(), hostSessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    if (room.hostPlayerId !== args.hostSessionId) {
      throw new Error('Only the host can finalize review')
    }
    await advanceIfNeeded(ctx, room)
  },
})

export const startNextRound = mutation({
  args: { code: v.string(), hostSessionId: v.string() },
  handler: async (ctx, args) => {
    const room = await getRoomOrThrow(ctx, args.code)
    if (room.hostPlayerId !== args.hostSessionId) {
      throw new Error('Only the host can continue')
    }
    if (room.status !== 'results') {
      return
    }
    await createRoundForRoom(ctx, room, room.currentRoundIndex + 1)
  },
})
