#!/usr/bin/env node
const yargs = require('yargs')
const args = yargs
  .commandDir('./src/cli')
  .demandCommand()
  .argv

if (!args._.length && !args.filename) {
  yargs.showHelp()
}
