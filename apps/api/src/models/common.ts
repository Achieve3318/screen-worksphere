import { randomUUID } from 'node:crypto'
import { Schema, type SchemaOptions } from 'mongoose'

export const uuidDefault = () => randomUUID()

export const baseOptions: SchemaOptions = {
  _id: false,
  versionKey: false,
  toJSON: {
    virtuals: false,
    transform(_doc, ret) {
      const out = ret as Record<string, unknown>
      if (out._id !== undefined && out.id === undefined) out.id = out._id
      delete out.__v
      return out
    },
  },
  toObject: {
    virtuals: false,
    transform(_doc, ret) {
      const out = ret as Record<string, unknown>
      if (out._id !== undefined && out.id === undefined) out.id = out._id
      delete out.__v
      return out
    },
  },
}

/** Primary key field: store as `_id`, expose as `id` in JSON. */
export function idField() {
  return { type: String, default: uuidDefault, required: true } as const
}

export function withId<T extends Record<string, unknown>>(doc: T | null | undefined): (T & { id: string }) | null {
  if (!doc) return null
  const raw = doc as T & { _id?: string; id?: string }
  const id = raw.id ?? raw._id
  if (!id) return { ...raw, id: '' }
  return { ...raw, id: String(id) }
}

export function withIds<T extends Record<string, unknown>>(docs: T[]): Array<T & { id: string }> {
  return docs.map((doc) => withId(doc)!)
}

export function SchemaWithId(definition: Record<string, unknown>, options: SchemaOptions = {}) {
  return new Schema(
    {
      _id: idField(),
      ...definition,
    },
    { ...baseOptions, ...options, _id: true },
  )
}
