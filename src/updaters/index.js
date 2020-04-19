module.exports = Block => {
  const from = async (url, ...args) => {
    // TODO: implement this
  }
  return { from, kv: require('./kv')(Block) }
}
