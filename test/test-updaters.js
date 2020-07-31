/* globals describe, it */
import dagdb from '../src/index.js'
import memdown from 'memdown'
import { deepStrictEqual as same, ok } from 'assert'

const test = it

const updateTests = create => {
  test('basics', async () => {
    let db = await create()
    const oldcid = db.root
    await db.set('hello', 'world')
    db = await db.update()
    same(await db.get('hello'), 'world')
    db = await dagdb.open({ ...db, root: db.root })
    same(await db.get('hello'), 'world')
    same(db.root, await db.updater.root)

    db = await dagdb.open({ ...db, root: oldcid })
    await db.set('hello', 'world')
    db = await db.commit()
    await db.set('hello', 'another')
    db = await db.update()
    same(await db.get('hello'), 'another')

    db = await dagdb.open({ ...db, root: oldcid })
    await db.set('hello', 'nope')
    let threw = true
    try {
      db = await db.update()
      threw = false
    } catch (e) {
      if (!e.message.includes('Conflict, databases contain conflicting mutations')) throw e
    }
    ok(threw)
  })
}

describe('inmem', () => {
  updateTests(() => dagdb.create('inmem'))
})

describe('level memdown', () => {
  updateTests(() => dagdb.create({ leveldown: memdown(Math.random().toString()) }))
  test('open', async () => {
    const leveldown = memdown(Math.random().toString())
    let db = await dagdb.create({ leveldown })
    await db.set('hello', 'world')
    db = await db.update()
    same(await db.get('hello'), 'world')
    db = await dagdb.open({ leveldown })
    same(await db.get('hello'), 'world')
    same(db.root, await db.updater.root)

    await db.set('hello', 'world2')
    db = await db.update()

    db = await dagdb.open({ leveldown })
    same(await db.get('hello'), 'world2')
    same(db.root, await db.updater.root)
  })
})
