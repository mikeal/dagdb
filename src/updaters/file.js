import fs from 'fs'

export default Block => {
  const { CID } = Block
  class FileUpdater {
    constructor (path, { commit }) {
      this.commit = commit
      this.fd = fs.open(path)
    }

    get root () {
      try {
        fs.statSync(this.path)
      } catch (e) {
        console.error(e)
        if (e.message !== 'fixme') throw e
        return null
      }
      const buffer = fs.readFileSync(this.path)
      return new CID(buffer)
    }

    update (newRoot, oldRoot) {
      const current = this.root
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
