const kv = require('./kv')
const database = require('./database')

module.exports = (...args) => {
  return {
    kv: kv(...args),
    database: database(...args)
  }
}
