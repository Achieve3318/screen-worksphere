import { hashPassword } from './security.js'
import { createDb } from './db.js'
import { parseEnv } from './env.js'
import { withId } from './models/index.js'

const env = parseEnv()
const connection = await createDb(env)
const { db } = connection
const passwordHash = await hashPassword(env.SEED_PASSWORD)

const organizationDoc = await db.Organization.findOneAndUpdate(
  { slug: 'northwind' },
  { $set: { name: env.SEED_ORG_NAME } },
  { upsert: true, new: true, setDefaultsOnInsert: true },
).lean()
const organization = withId(organizationDoc)!

await db.ScreenshotPolicy.findOneAndUpdate(
  { organizationId: organization.id },
  { $setOnInsert: { organizationId: organization.id } },
  { upsert: true, new: true },
)

const users = [
  { email: 'owner@example.com', name: 'Demo Owner', role: 'OWNER' as const },
  { email: 'admin@example.com', name: 'Demo Admin', role: 'ADMIN' as const },
  { email: 'manager@example.com', name: 'Demo Manager', role: 'MANAGER' as const },
  { email: 'member@example.com', name: 'Demo Member', role: 'MEMBER' as const },
]

for (const user of users) {
  await db.User.findOneAndUpdate(
    { email: user.email },
    {
      $set: { name: user.name, role: user.role, passwordHash, disabledAt: null },
      $setOnInsert: {
        organizationId: organization.id,
        email: user.email,
      },
    },
    { upsert: true, new: true },
  )
}

const teamDoc = await db.Team.findOneAndUpdate(
  { organizationId: organization.id, name: 'Design' },
  { $setOnInsert: { organizationId: organization.id, name: 'Design' } },
  { upsert: true, new: true },
).lean()
const team = withId(teamDoc)!

const manager = withId(await db.User.findOne({ email: 'manager@example.com' }).lean())!
const member = withId(await db.User.findOne({ email: 'member@example.com' }).lean())!
await db.TeamMember.updateOne(
  { teamId: team.id, userId: manager.id },
  { $set: { teamRole: 'LEAD' }, $setOnInsert: { teamId: team.id, userId: manager.id } },
  { upsert: true },
)
await db.TeamMember.updateOne(
  { teamId: team.id, userId: member.id },
  { $setOnInsert: { teamId: team.id, userId: member.id, teamRole: 'MEMBER' } },
  { upsert: true },
)

console.log(`Seeded ${organization.name}`)
console.log('Demo accounts use SEED_PASSWORD from the environment.')
console.log('owner@example.com admin@example.com manager@example.com member@example.com')
await connection.close()