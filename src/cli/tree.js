import createParser from './argv.js'
import * as init from './init.js'

export default async argv => {
  const commands = { init }
  const commandNames = Object.keys(commands)

  if (!argv.length) {
    throw new Error('Missing arguments')
  }

  const command = argv.shift()
  if (!commandNames.includes(command)) throw new Error('Unknown command')
  const parser = createParser(commands[command].options)
  const args = await parser(argv)
  console.log({ args })
  await commands[command].handler(args)
}
