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
  const parsed = new URL('http://asdf' + req.url)
  const params = { }
  if (parsed.searchParams.has('depth')) {
    params.depth = parseInt(parsed.searchParams.get('depth'))
  }
  const [method, path] = [req.method, req.url]
  const result = await _handler({ method, path, params, body })
  res.writeHead(result.statusCode || 200, result.headers || {})
  res.end(result.body)
}

const createHandler = (Block, store, _updater, infoOpts = {}) => {
  const blockstoreHandler = blockstore(Block, store)
  const updaterHandler = updater(Block, _updater)
  const _handler = (req, res) => {
    if (req.url === '/') {
      return info(store, updater)
    }
    if (req.url.startsWith('/blockstore/')) {
      req.url = req.url.slice('/blockstore/'.length)
      return handler(req, res, blockstoreHandler)
    } else if (req.url.startsWith('/updater')) {
      req.url = '/' + req.url.slice(0, '/updater/'.length)
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
