import createHttp from './https.js'
import createInmemory from './inmemory.js'

export default Block => {
  const http = createHttp(Block)
  const inmem = createInmemory(Block)
  const from = str => {
    if (str.startsWith('http://') || /* c8 ignore next */ str.startsWith('https://')) {
      return http(str)
    }
    throw new Error(`Cannot resolve identifier "${str}"`)
  }
  const create = str => {
    if (str === 'inmem' || str === 'inmemory') {
      return inmem()
    }
  }
  return { from, create }
}
