module.exports = Block => {
  return {
    kv: require('./kv')(Block)
  }
}
