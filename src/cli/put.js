
const { /*  readwrite, */ checkfile, options } = require('../car')
// const Block = require('@ipld/block')
// const database = require('../database')(Block)

const put = async argv => {
  await checkfile(argv.dbfile)
  // const { reader, writer, store, root } = await readwrite(argv.dbfile)
  // const db = database(root, store)
}
exports.handler = put
exports.desc = 'Sets <key> to a new document encoded from <json>'
exports.command = 'put <key> <json>'
exports.builder = yargs => {
  options(yargs)
  yargs.positional('key', {
    desc: 'String key to set'
  })
  yargs.positional('json', {
    desc: 'Full document body as JSON'
  })
}
