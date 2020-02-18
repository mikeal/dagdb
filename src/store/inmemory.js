class InMemory {
  constructor () {
    this.storage = new Map()
  }
  async put (block) {
    console.log({put: this})
    const cid = await block.cid()
    this.storage.set(cid.toString('base64'), block)
  }
  async get (cid) {
    const key = cid.toString('base64')
    return this.storage.get(key)
  }
}

module.exports = (...args) => new InMemory(...args)
