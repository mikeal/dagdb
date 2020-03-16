const { stat } = require('fs').promises
const { createWriteStream } = require('fs')
const { options } = require('../car')
const carfile = require('datastore-car')
const Block = require('@ipld/block')
const database = require('../database')(Block)

const missing = async filename => {
  try {
    await stat(filename)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
    return true
  }
  return false
}

const init = async argv => {
  if (!(await missing(argv.dbfile))) {
    console.error('file already exists')
    process.exit(1)
  }
  const car = await carfile.writeStream(createWriteStream(argv.dbfile))
  const empties = await Promise.all(database.empties)
  const [empty] = empties
  await car.setRoots([await empty.cid()])
  const putBlock = block => block.cid().then(cid => car.put(cid, block.encodeUnsafe()))
  await Promise.all(empties.map(putBlock))
  await car.close()
  console.log(`Initialized empty database in ${argv.dbfile}`)
}
exports.handler = init
exports.desc = 'Create initial db file'
exports.command = 'init'
exports.builder = options
