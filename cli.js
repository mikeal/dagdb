#!/usr/bin/env node
const yargs = require('yargs')
const args = yargs
  .commandDir('./src/cli')
  .argv

if (!args._.length && !args.filename) {
  yargs.showHelp()
}
