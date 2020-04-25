const { blockstore, info, updater } = require('./handlers')

const getBody = stream => new Promise((resolve, reject) => {
  const buffers = []
  stream.on('error', reject)
  stream.on('data', chunk => buffers.push(chunk))
  stream.on('end', () => resolve(Buffer.concat(buffers)))
})

const handler = async (req, res, _handler) => {
  let body
  if (req.method === 'PUT') {
    body = await getBody(req)
  }
  const parsed = new URL('http://asdf/' + req.url)
  const params = { }
  for (const [key, value] of parsed.searchParams.entries()) {
    params[key] = value
    if (key === 'depth') {
      params.depth = parseInt(params.depth)
    }
    if (value === 'null') params[key] = null
  }
  const [method, path] = [req.method, parsed.pathname]
  const result = await _handler({ method, path, params, body })
  res.writeHead(result.statusCode || 200, result.headers || {})
  res.end(result.body)
}

const createHandler = (Block, store, _updater, infoOpts = {}) => {
  const blockstoreHandler = blockstore(Block, store)
  const updaterHandler = updater(_updater)
  const infoHandler = info(store, _updater)
  const _handler = (req, res, basepath = '') => {
    if (req.url === basepath || req.url === basepath + '/') {
      return handler(req, res, infoHandler)
    }
    req.url = req.url.slice(basepath.length)
    if (req.url.startsWith('/blockstore/')) {
      req.url = req.url.slice('/blockstore/'.length)
      return handler(req, res, blockstoreHandler)
    } else if (req.url.startsWith('/updater')) {
      req.url = req.url.slice('/updater'.length)
      return handler(req, res, updaterHandler)
    } else {
      res.statusCode = 404
      res.end('Not found')
    }
  }
  return _handler
}

module.exports = createHandler

module.exports.blockstore = (...args) => {
  const _handler = blockstore(...args)
  return (req, res) => handler(req, res, _handler)
}
module.exports.updater = (...args) => {
  const _handler = updater(...args)
  return (req, res) => handler(req, res, _handler)
}
