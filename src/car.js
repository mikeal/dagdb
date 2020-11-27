import { promises as fs } from 'fs'
import carfile from 'datastore-car'
import createInmemory from './stores/inmemory.js'
import Block from '@ipld/block/defaults.js'
import mkdatabase from './database.js'
import path from 'path'

const database = mkdatabase(Block)
const { stat, rename } = fs

const getRoot = async car => {
  const [root, ...nope] = await car.getRoots()
  if (nope.length) {
    throw new Error('No support for CAR files with multiple roots')
  }
  return root
}

const loadReadOnly = async filename => {
  // const stream = fs.createReadStream(filename)
  const car = await carfile.readFileComplete(filename)
  const root = await getRoot(car)
  const store = { get: cid => car.get(cid).then(data => Block.create(data, cid)) }
  return database(root, store)
}
const loadWritable = async filename => {
}

const options = yargs => {
  yargs.option('dbfile', {
    desc: 'File containing the database',
    default: '.dagdb.car'
  })
}
const checkfile = async file => {
  let exists
  try {
    exists = await stat(file)
  } catch (e) {
    if (!e.code === 'ENOENT') throw e
  }
  if (!exists) {
    if (file === './.dagdb.car') {
      console.error('You must run `init` to create a .dagdb.car file in the current directory')
    } else {
      console.error(`No such file "${file}"`)
    }
    process.exit(1)
  }
  return exists
}

const traverse = async function * (cid, get, seen = new Set()) {
  const block = await get(cid)
  yield block
  seen.add(cid.toString('base32'))
  for (const [, link] of block.reader().links()) {
    if (seen.has(link.toString('base32'))) continue
    yield * traverse(link, get, seen)
  }
}

const readwrite = async (filename, exportFile) => {
  await checkfile(filename)
  const reader = await loadReadOnly(filename)
  const inmem = createInmemory(Block)
  const cache = inmem()
  const put = cache.put.bind(cache)
  const get = async cid => {
    try {
      const block = await cache.get(cid)
      return block
    } catch (e) {
      if (e.statusCode !== 404) throw e
      return reader.get(cid).then(data => Block.create(data, cid))
    }
  }
  const store = { get, put }
  const write = async newRoot => {
    const dir = path.dirname(filename)
    const base = path.basename(filename)
    const f = path.join(dir, '.tmp.' + base)
    const writer = await loadWritable(f)
    await writer.setRoots([newRoot])
    for await (const block of traverse(newRoot, get)) {
      writer.put(await block.cid(), block.encodeUnsafe())
    }
    await writer.close()
    await rename(f, exportFile || filename)
  }
  const [root] = await reader.getRoots()
  return { write, root, store }
}

export { loadReadOnly, loadWritable, options, checkfile, readwrite }
