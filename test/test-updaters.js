/* globals describe, it */
import dagdb from '../src/index.js'
import { deepStrictEqual as same, ok } from 'assert'

const test = it

describe('inmem', () => {
  test('basics', async () => {
    let db = await dagdb.create('inmem')
    const oldcid = db.root
    await db.set('hello', 'world')
    db = await db.update()
    same(await db.get('hello'), 'world')
    db = await dagdb.open({ ...db, root: db.root })
    same(await db.get('hello'), 'world')
    same(db.root, db.updater.root)

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
})
