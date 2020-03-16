const { readonly, checkfile, options } = require('../car')

const handler = async argv => {
  await checkfile(argv.dbfile)
  const db = await readonly(argv.dbfile)
  const info = await db.info()
  console.log(info)
}

exports.handler = handler
exports.desc = 'Print info about a database'
exports.command = 'info'
exports.builder = yargs => {
  options(yargs)
}
