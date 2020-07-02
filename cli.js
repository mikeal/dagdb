#!/usr/bin/env node
import yargs from 'yargs'

const args = yargs
  .commandDir('./src/cli')
  .demandCommand()
  .argv

if (!args._.length && !args.filename) {
  yargs.showHelp()
}
