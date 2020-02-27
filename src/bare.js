module.exports = (...args) => {
  return {
    kv: require('./kv')(...args)
  }
}
