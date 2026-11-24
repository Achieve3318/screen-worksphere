import mongoose from 'mongoose'
import type { Env } from './env.js'
import { db, type Db } from './models/index.js'

export type { Db }

export async function createDb(env: Env): Promise<{ db: Db; close: () => Promise<void> }> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.DATABASE_URL)
  await Promise.all(Object.values(db).map((model) => model.syncIndexes()))
  return {
    db,
    close: async () => {
      await mongoose.disconnect()
    },
  }
}

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void>; uri: string }> {
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  const memory = await MongoMemoryServer.create()
  const uri = memory.getUri('screenvault-test')
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  await Promise.all(Object.values(db).map((model) => model.syncIndexes()))
  return {
    db,
    uri,
    close: async () => {
      await mongoose.disconnect()
      await memory.stop()
    },
  }
}
