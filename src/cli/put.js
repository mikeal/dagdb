
import { checkfile, options } from '../car.js'
// const Block = require('@ipld/block')
// const database = require('../database')(Block)

const put = async argv => {
  await checkfile(argv.dbfile)
  // const { reader, writer, store, root } = await readwrite(argv.dbfile)
  // const db = database(root, store)
}
const handler = put
const desc = 'Sets <key> to a new document encoded from <json>'
const command = 'put <key> <json>'
const builder = yargs => {
  options(yargs)
  yargs.positional('key', {
    desc: 'String key to set'
  })
  yargs.positional('json', {
    desc: 'Full document body as JSON'
  })
}
export { handler, desc, command, builder }
