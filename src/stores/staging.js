import createInmemory from './inmemory.js'
// import createReplicate from './replicate.js'

/**
 * @param {Block} Block The IPLD Block interface to use.
 */
const create = Block => {
  // const replicate = createReplicate(Block)
  const inmemory = createInmemory(Block)

  /**
   * A wrapper store that provides a "staging" area for uncommitted operations/blocks.
   */
  class Staging {
    /**
     * Create a new staging store that wraps two stores.
     * @param {Store} main The primary backing store.
     * @param {Store} staging The staging area/store. Defaults to an inmemory store.
     */
    constructor (main, staging = inmemory()) {
      if (main instanceof Staging) {
        this.main = main.main
        this.staging = main.staging
      } else {
        this.main = main
        this.staging = staging
      }
    }

    get storage () {
      return this.main.storage
    }

    async merge () {
      // FIXME: Hack for now to simply assume we're uing an inmemory store
      const promises = []
      for (const block of this.staging.storage.values()) {
        promises.push(this.main.put(block))
      }
      await Promise.all(promises)
      this.staging = inmemory()
      return this
    }

    /**
     * Put the given block in the staging area.
     * @param {Block} block The unput block.
     * @param {boolean} force Whether to put straight to main. Defaults to false.
     * @returns {void}
     */
    async put (block, force = false) {
      if (force) {
        return this.main.put(block)
      }
      return this.staging.put(block)
    }

    /**
     * Check if a given block/cid exists in either store (main or staging).
     * @param {CID} cid The input cid.
     * @returns {boolean | number}
     */
    async has (cid) {
      const has = await this.main.has(cid)
      if (has) {
        return has
      }
      return this.staging.has(cid)
    }

    /**
     * Get the block behind the given cid.
     * @param {CID} cid
     * @throws If cid is not found in either store.
     * @returns {Block} The block.
     */
    async get (cid) {
      const has = await this.main.has(cid)
      if (has) {
        return this.main.get(cid)
      }
      return this.staging.get(cid)
    }
  }

  return (...args) => new Staging(...args)
}

export default create
