import fs from 'fs'
import { CID } from 'multiformats'

class FileUpdater {
  constructor (path) {
    this.path = path
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
    return CID.decode(buffer)
  }

  update (newRoot, oldRoot) {
    const current = this.root
    /* c8 ignore next */
    if (current && !oldRoot) return current
    if (!oldRoot || current.equals(oldRoot)) {
      fs.writeFileSync(this.path, newRoot.bytes)
      if (this.onUpdate) /* c8 ignore next */ this.onUpdate()
      return newRoot
    }
    return current
  }
}

const create = (...args) => new FileUpdater(...args)
export default create
