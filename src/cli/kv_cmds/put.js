const { readwrite, checkfile, options } = require('../../car')
const Block = require('@ipld/block')
const database = require('../../database')(Block)

const put = async argv => {
  await checkfile(argv.dbfile)
  const { reader, writer, store, root } = await readwrite(argv.dbfile)
  const db = database(root, store)
}
exports.handler = put
exports.desc = 'Sets the given key to a new document encoded from the given JSON'
exports.command = 'put <tag> <key> <json>'
exports.builder = options
