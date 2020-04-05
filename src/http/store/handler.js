const CID = require('cids')

const jsonHeaders = body => {
  return { 'content-length': body.length, 'content-type': 'application/json' }
}

module.exports = (Block, store, depthLimit = 1024) => {
  const handler = async opts => {
    let { method, path, params, body } = opts
    if (!method) throw new Error('Missing required param method')
    if (!path) throw new Error('Missing required param path')
    if (path[0] === '/') path = path.slice(1)
    if (method === 'PUT' && !body) {
      throw new Error('Missing required param body')
    }
    if (method === 'GET') {
      if (path.includes('/graph')) {
        const [key] = path.split('/')
        let { depth, missing, incomplete, skips } = params
        if (missing) missing = new Set(missing)
        if (incomplete) incomplete = new Set(incomplete)
        if (skips) skips = new Set(skips)
        if (typeof depth !== 'undefined') {
          if (depth > depthLimit) throw new Error(`Depth is greater than max limit of ${depthLimit}`)
        } else {
          depth = depthLimit
        }
        const result = await store.graph(new CID(key), depth, missing, incomplete, skips)
        if (result.missing) result.missing = Array.from(result.missing)
        if (result.incomplete) result.incomplete = Array.from(result.incomplete)
        const body = Buffer.from(JSON.stringify({ result, depth }))
        return { headers: jsonHeaders(body), body }
      } else {
        if (path.includes('/')) throw new Error('Path for block retreival must not include slashes')
        const cid = new CID(path)
        let block
        try {
          block = await store.get(cid)
        } catch (e) {
          if (e.statusCode === 404) return { statusCode: 404 }
          throw e
        }
        const body = block.encodeUnsafe()
        return { headers: { 'content-length': body.length }, body }
      }
    } else if (method === 'PUT') {
      if (path.includes('/')) throw new Error('Path for block retreival must not include slashes')
      const cid = new CID(path)
      const block = Block.create(body, cid)
      await store.put(block)
      return { statusCode: 201 }
    } else if (method === 'HEAD') {
      if (path.includes('/')) throw new Error('Path for block retreival must not include slashes')
      const cid = new CID(path)
      const has = await store.has(cid)
      if (!has) return { statusCode: 404 }
      if (has.length) return { headers: { 'content-length': has.length } }
      return { statusCode: 200 }
    } else {
      const e = new Error('Unknown method')
      e.statusCode = 405
      throw e
    }
  }
  return handler
}
