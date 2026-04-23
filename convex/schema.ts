import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    hostPlayerId: v.string(),
    status: v.union(
      v.literal('lobby'),
      v.literal('playing'),
      v.literal('review'),
      v.literal('results'),
      v.literal('finished'),
    ),
    config: v.object({
      roundCount: v.union(v.literal(1), v.literal(3), v.literal(5), v.literal(7)),
      roundDurationSeconds: v.union(
        v.literal(30),
        v.literal(60),
        v.literal(120),
        v.literal(180),
      ),
      maxPlayers: v.literal(16),
    }),
    currentRoundIndex: v.number(),
    usedLetters: v.array(v.string()),
    usedCategoryIds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_code', ['code']),

  players: defineTable({
    roomId: v.id('rooms'),
    sessionId: v.string(),
    nickname: v.string(),
    scoreTotal: v.number(),
    ready: v.boolean(),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  }).index('by_room', ['roomId']),

  rounds: defineTable({
    roomId: v.id('rooms'),
    index: v.number(),
    letter: v.string(),
    categoryIds: v.array(v.string()),
    startedAt: v.number(),
    endsAt: v.number(),
    status: v.union(v.literal('playing'), v.literal('review'), v.literal('scored')),
    scoreDetails: v.array(
      v.object({
        playerId: v.string(),
        categoryId: v.string(),
        answer: v.string(),
        valid: v.boolean(),
        duplicate: v.boolean(),
        points: v.number(),
      }),
    ),
  }).index('by_room', ['roomId']),

  submissions: defineTable({
    roundId: v.id('rounds'),
    playerId: v.string(),
    answers: v.record(v.string(), v.string()),
    submittedAt: v.union(v.number(), v.null()),
  }).index('by_round', ['roundId']),

  votes: defineTable({
    roundId: v.id('rounds'),
    targetPlayerId: v.string(),
    categoryId: v.string(),
    voterPlayerId: v.string(),
    approved: v.boolean(),
  }).index('by_round', ['roundId']),

  categoryCatalog: defineTable({
    slug: v.string(),
    label: v.string(),
    seedOrder: v.number(),
  }).index('by_seed_order', ['seedOrder']),
})
