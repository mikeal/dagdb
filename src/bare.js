module.exports = (...args) => {
  return {
    kv: require('./kv')(...args),
    database: require('./database')(...args)
  }
}
