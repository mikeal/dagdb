class InMemory {
  constructor () {
    this.storage = new Map()
  }
  async put (block) {
    const cid = await block.cid()
    this.storage.set(cid.toString('base64'), block)
  }
  async get (cid) {
    const key = cid.toString('base64')
    const value = this.storage.get(key)
    if (!value) throw new Error(`Do not have ${key} in store`)
    return value
  }
}

module.exports = (...args) => new InMemory(...args)
