import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('')
}

export const getRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()

    if (!room) {
      return null
    }

    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()

    return {
      ...room,
      players: players.sort((left, right) => left.joinedAt - right.joinedAt),
    }
  },
})

export const createRoom = mutation({
  args: {
    sessionId: v.string(),
    nickname: v.string(),
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
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const hostPlayerId = args.sessionId
    let code = ''
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = makeCode()
      const existing = await ctx.db
        .query('rooms')
        .withIndex('by_code', (q) => q.eq('code', candidate))
        .unique()
      if (!existing) {
        code = candidate
        break
      }
    }

    if (!code) {
      throw new Error('Unable to generate room code')
    }

    const roomId = await ctx.db.insert('rooms', {
      code,
      hostPlayerId,
      status: 'lobby',
      config: args.config,
      currentRoundIndex: 0,
      usedLetters: [],
      usedCategoryIds: [],
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.insert('players', {
      roomId,
      sessionId: args.sessionId,
      nickname: args.nickname || 'Player',
      scoreTotal: 0,
      ready: false,
      joinedAt: now,
      lastSeenAt: now,
    })

    return { code }
  },
})

export const joinRoom = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    nickname: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()

    if (!room) {
      throw new Error('Room not found')
    }

    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()

    const existing = players.find((player) => player.sessionId === args.sessionId)
    const now = Date.now()

    if (existing) {
      await ctx.db.patch(existing._id, {
        nickname: args.nickname || existing.nickname,
        lastSeenAt: now,
      })
      await ctx.db.patch(room._id, { updatedAt: now })
      return { ok: true }
    }

    if (players.length >= room.config.maxPlayers) {
      throw new Error('Room is full')
    }

    await ctx.db.insert('players', {
      roomId: room._id,
      sessionId: args.sessionId,
      nickname: args.nickname || 'Player',
      scoreTotal: 0,
      ready: false,
      joinedAt: now,
      lastSeenAt: now,
    })

    await ctx.db.patch(room._id, { updatedAt: now })
    return { ok: true }
  },
})

export const setReady = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    ready: v.boolean(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()
    if (!room) {
      throw new Error('Room not found')
    }
    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()
    const player = players.find((entry) => entry.sessionId === args.sessionId)
    if (!player) {
      throw new Error('Player not found')
    }
    const now = Date.now()
    await ctx.db.patch(player._id, { ready: args.ready, lastSeenAt: now })
    await ctx.db.patch(room._id, { updatedAt: now })
  },
})

export const renamePlayer = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
    nickname: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()
    if (!room) {
      throw new Error('Room not found')
    }
    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()
    const player = players.find((entry) => entry.sessionId === args.sessionId)
    if (!player) {
      throw new Error('Player not found')
    }
    const now = Date.now()
    await ctx.db.patch(player._id, {
      nickname: args.nickname || 'Player',
      lastSeenAt: now,
    })
    await ctx.db.patch(room._id, { updatedAt: now })
  },
})

export const heartbeat = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()
    if (!room) {
      return
    }
    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()
    const player = players.find((entry) => entry.sessionId === args.sessionId)
    if (!player) {
      return
    }
    const now = Date.now()
    await ctx.db.patch(player._id, { lastSeenAt: now })
    await ctx.db.patch(room._id, { updatedAt: now })
  },
})

export const leaveRoom = mutation({
  args: {
    code: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db
      .query('rooms')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique()
    if (!room) {
      return
    }
    const players = await ctx.db
      .query('players')
      .withIndex('by_room', (q) => q.eq('roomId', room._id))
      .collect()
    const player = players.find((entry) => entry.sessionId === args.sessionId)
    if (!player) {
      return
    }

    await ctx.db.delete(player._id)
    const remainingPlayers = players.filter((entry) => entry._id !== player._id)

    if (remainingPlayers.length === 0) {
      await ctx.db.delete(room._id)
      return
    }

    const oldest = [...remainingPlayers].sort((left, right) => left.joinedAt - right.joinedAt)[0]
    await ctx.db.patch(room._id, {
      hostPlayerId: oldest?.sessionId === room.hostPlayerId ? room.hostPlayerId : oldest.sessionId,
      updatedAt: Date.now(),
    })
  },
})
