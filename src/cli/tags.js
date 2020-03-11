const { loadReadOnly, checkfile, options } = require('../car')

const tags = async argv => {
  await checkfile(argv.dbfile)
  const db = await loadReadOnly(argv.dbfile)
  let hasTags = false
  for await (const [key, block] of db.tags({ blocks: true })) {
    hasTags = true
    const decoded = block.decodeUnsafe()
    console.log(key, Object.keys(decoded)[0])
  }
  if (!hasTags) {
    console.error('No tags in this database')
    process.exit(1)
  }
}
exports.handler = tags
exports.desc = 'List all tags'
exports.command = 'tags'
exports.builder = options
