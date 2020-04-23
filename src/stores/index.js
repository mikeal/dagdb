const createHttp = require('./https')

module.exports = Block => {
  const http = createHttp(Block)
  const from = str => {
    if (str.startsWith('http://') || /* istanbul ignore next */ str.startsWith('https://')) {
      return http(str)
    }
    throw new Error(`Cannot resolve identifier "${str}"`)
  }
  return { from }
}
