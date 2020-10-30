import http from './https.js'
import inmem from './inmemory.js'
import level from './level.js'
import s3 from './s3.js'
import leveljs from 'level-js'

const fromId = id => {
  if (typeof id === 'object') {
    if (id.leveldown) return level(id.leveldown)
    if (id.s3) return s3(id.s3) /* c8 ignore next */
    /* c8 ignore next */
    if (id.browser) {
      /* c8 ignore next */
      return level(leveljs('dagdb'))
    } /* c8 ignore next */
  } else {
    if (id.startsWith('http://') || /* c8 ignore next */ id.startsWith('https://')) {
      return http(id)
    }
  }
  throw new Error(`Cannot resolve identifier "${id}"`)
}
const create = id => {
  if (id === 'inmem' || id === 'inmemory') {
    return inmem()
  } else if (typeof id === 'object') {
    if (id.leveldown) return level(id.leveldown)
    if (id.s3) return s3(id.s3) /* c8 ignore next */
    /* c8 ignore next */
    if (id.browser) {
      /* c8 ignore next */
      return level(leveljs('dagdb'))
    } /* c8 ignore next */
  }
}

export { fromId, create }
