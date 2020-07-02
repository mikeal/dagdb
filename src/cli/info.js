import { readonly, checkfile, options } from '../car.js'

const handler = async argv => {
  await checkfile(argv.dbfile)
  const db = await readonly(argv.dbfile)
  const info = await db.info()
  console.log(info)
}

const desc = 'Print info about a database'
const command = 'info'
const builder = yargs => {
  options(yargs)
}

export { handler, desc, command, builder }
