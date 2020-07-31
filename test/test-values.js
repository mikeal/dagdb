/* globals describe, it */
import Block from '@ipld/block/defaults.js'
import createInmemory from '../src/stores/inmemory.js'
import createKV from '../src/kv.js'
import assert from 'assert'

const inmem = createInmemory(Block)
const kv = createKV(Block)
const test = it
const same = assert.deepStrictEqual
const { toString } = Block.multiformats.bytes

const create = async (_kv = kv) => {
  const store = inmem()
  const kvs = await _kv.create(store)
  return { store, kvs }
}

const basics = async kv => {
  const { kvs } = await create(kv)
  await kvs.set('test', { hello: 'world' })
  let obj = await kvs.get('test')
  same(obj, { hello: 'world' })
  const latest = await kvs.commit()
  obj = await latest.get('test')
  same(obj, { hello: 'world' })
  return latest
}

describe('test-values', () => {
  test('string', async () => {
    let db = await basics(kv)
    await db.set('foo', 'bar')
    same(await db.get('foo'), 'bar')
    db = await db.commit()
    same(await db.get('foo'), 'bar')
  })

  test('links', async () => {
    let db = await basics(kv)
    const block = await db.getBlock('test')
    const linked = { test: await block.cid() }
    await db.set('linked', linked)
    let val = await db.get('linked')
    same(await val.test(), { hello: 'world' })
    db = await db.commit()
    val = await db.get('linked')
    same(await val.test(), { hello: 'world' })

    // test w/ getter block caching
    await val.test()
    await db.set('fromLinked', val)
    val = await db.get('fromLinked')
    same(await val.test(), { hello: 'world' })
    db = await db.commit()
    val = await db.get('fromLinked')
    same(await val.test(), { hello: 'world' })

    // test w/o getter block caching
    val = await db.get('fromLinked')
    await db.set('fromLinkedNoCache', val)
    same(await val.test(), { hello: 'world' })
    db = await db.commit()
    val = await db.get('fromLinked')
    same(await val.test(), { hello: 'world' })

    // test equals
    val = val.test
    same(val.equals(val), true)
    same(val.equals(val.cid), true)
    const newlink = await db.link(Math.random())
    same(val.equals(newlink), false)
    same(val.equals(newlink.cid), false)
  })

  test('blocks as links', async () => {
    let db = await basics(kv)
    const block = await db.getBlock('test')
    const linked = { test: block }
    await db.set('linked', linked)
    let val = await db.get('linked')
    same(await val.test(), { hello: 'world' })
    db = await db.commit()
    val = await db.get('linked')
    same(await val.test(), { hello: 'world' })
  })

  test('arrays', async () => {
    const db = await basics(kv)
    const block = await db.getBlock('test')
    await db.set('arr', ['asdf', { hello: 'world' }, block])

    const val = await db.get('arr')
    assert.ok(Array.isArray(val))
    same(val[0], 'asdf')
    same(val[1], { hello: 'world' })
    same(await val[2](), { hello: 'world' })
  })

  test('kv in kv', async () => {
    const db = await basics(kv)
    await db.set('kvInKv', db)
    const cid = db.root
    assert.ok(cid.equals((await db.get('kvInKv')).root))
    const latest = await db.commit()
    assert.ok((await latest.get('kvInKv')).root.equals(db.root))

    await db.set('dirty', 'test')
    await latest.set('with-cache', db)
    // the latest changes would be commited so it wouldn't
    // match the old transaction root
    assert(!db.root.equals(await latest.get('with-cache')))
  })

  const load = async function * (...args) {
    yield * args
  }

  test('stream fbl', async () => {
    const iter = load(Buffer.from('1234'), Buffer.from('5678'))
    let db = await basics()
    await db.set('test', { stream: iter })
    db = await db.commit()
    const obj = await db.get('test')
    let expected = ['1234', '5678']
    for await (const buffer of obj.stream) {
      same(expected.shift(), toString(buffer))
    }
    await db.set('test2', { two: obj.stream })
    db = await db.commit()
    const obj2 = await db.get('test2')
    expected = ['1234', '5678']
    for await (const buffer of obj2.two) {
      same(expected.shift(), toString(buffer))
    }
    for await (const buffer of obj2.two.read(0, 2)) {
      same(toString(buffer), '12')
    }
  })
})
