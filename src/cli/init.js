import { promises as fs, createWriteStream } from 'fs'

import { options } from '../car.js'
import carfile from 'datastore-car'
import Block from '@ipld/block/defaults.js'
import createDatabase from '../database.js'

const database = createDatabase(Block)

const { stat } = fs

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
const handler = init
const desc = 'Create initial db file'
const command = 'init'
const builder = options

export { handler, desc, command, builder }
