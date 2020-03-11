exports.command = 'kv <command>'
exports.desc = 'Commands for interacting with key-value stores'
exports.builder = yargs => yargs.commandDir('kv_cmds')
exports.handler = argv => {}
