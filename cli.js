#!/usr/bin/env node
const commands = require('./src/cli.js')
const { stat } = require('fs').promises

const checkfile = async file => {
  let exists
  try {
    exists = await stat(file)
  } catch (e) {
    if (!e.code === 'ENOENT') throw e
  }
  if (!exists) {
    if (file === './.dagdb.car') {
      console.error('You must run `init` to create a .dagdb.car file in the current directory')
    } else {
      console.error(`No such file "${file}"`)
    }
    process.exit(1)
  }
  return exists
}

const globalOptions = yargs => {
  yargs.option('dbfile', {
    desc: 'File containing the database',
    default: './.dagdb.car'
  })
}
const tagOptions = yargs => {
  globalOptions(yargs)
}
const initOptions = yargs => {
  globalOptions(yargs)
}
const listOptions = yargs => {
  globalOptions(yargs)
  yargs.positional('tag', {
    desc: 'The tag of the key-value store.'
  })
}

const runner = name => async argv => {
  await checkfile(argv.dbfile)
  return commands[name](argv)
}

/* eslint-ignore-next */
const yargs = require('yargs')
const args = yargs
  .command('init', 'Create an empty database', initOptions, commands.init)
  .command('list <tag>', 'List all keys in a key-value store.', listOptions, runner('list'))
  .command('tags', 'List all the tags in the database.', tagOptions, runner('tags'))
  .argv

if (!args._.length && !args.filename) {
  yargs.showHelp()
}
