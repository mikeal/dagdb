const fs = require('fs')
const { stat } = require('fs').promises
const carfile = require('datastore-car')
const Block = require('@ipld/block')
const database = require('./database')(Block)

const getRoot = async car => {
  const [root, ...nope] = await car.getRoots()
  if (nope.length) {
    throw new Error('No support for CAR files with multiple roots')
  }
  return root
}

const missing = async filename => {
  try {
    await stat(filename)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    return true
  }
  return false
}

const loadReadonly = async filename => {
  // const stream = fs.createReadStream(filename)
  const car = await carfile.readFileComplete(filename)
  const root = await getRoot(car)
  const store = { get: cid => car.get(cid).then(data => Block.create(data, cid)) }
  return database(root, store)
}
const loadWritable = async filename => {
}

const tags = async argv => {
  const db = await loadReadonly(argv.dbfile)
  let hasTags = false
  for await (const [key, block] of db.tags({blocks: true})) {
    hasTags = true
    const decoded = block.decodeUnsafe()
    console.log(key, Object.keys(decoded)[0])
  }
  if (!hasTags) {
    console.error('No tags in this database')
    process.exit(1)
  }
}

const list = async argv => {
  const db = await loadReadonly(argv.dbfile)
}
const init = async argv => {
  if (!(await missing(argv.dbfile))) {
    console.error('file already exists')
    process.exit(1)
  }
  const car = await carfile.writeStream(fs.createWriteStream(argv.dbfile))
  const empties = await Promise.all(database.empties)
  const [empty] = empties
  await car.setRoots([await empty.cid()])
  const putBlock = block => block.cid().then(cid => car.put(cid, block.encodeUnsafe()))
  await Promise.all(empties.map(putBlock))
  await car.close()
}

exports.init = init
exports.list = list
exports.tags = tags
