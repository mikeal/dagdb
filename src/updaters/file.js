import fs from 'fs'

export default Block => {
  const { CID } = Block
  class FileUpdater {
    constructor (path, opts={}) {
      this.path = path
      this.commit = opts.commit
    }

    get root () {
      try {
        fs.statSync(this.path)
      } catch (e) {
        /* c8 ignore next */
        if (e.code !== 'ENOENT') throw e
        return null
      }
      const buffer = fs.readFileSync(this.path)
      return new CID(buffer)
    }

    update (newRoot, oldRoot) {
      const current = this.root
      /* c8 ignore next */
      if (current && !oldRoot) return current
      if (!oldRoot || current.equals(oldRoot)) {
        fs.writeFileSync(this.path, newRoot.buffer)
        return newRoot
      }
      return current
    }
  }
  return (...args) => new FileUpdater(...args)
}
