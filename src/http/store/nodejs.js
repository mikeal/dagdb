const createHandler = require('./handler')

const getBody = stream => new Promise((resolve, reject) => {
  const buffers = []
  stream.on('error', reject)
  stream.on('data', chunk => buffers.push(chunk))
  stream.on('end', () => resolve(Buffer.concat(buffers)))
})

module.exports = (Block, store, depthLimit) => {
  const _handler = createHandler(Block, store, depthLimit)
  const handler = async (req, res) => {
    let body
    if (req.method === 'PUT') {
      body = await getBody(req)
    }
    const parsed = new URL('http://asdf' + req.url)
    const params = { }
    for (let [key, value] of parsed.searchParams.entries()) {
      if (typeof value === 'undefined') continue
      if (key === 'depth') value = parseInt(value)
      params[key] = value
    }
    const [method, path] = [req.method, req.url]
    let result
    try {
      result = await _handler({ method, path, params, body })
    } catch (e) {
      if (e.statusCode) {
        res.statusCode = e.statusCode
        res.end(e.statusCode === 404 ? 'Not found' : e.message)
      }
      throw e
    }

    res.writeHead(result.statusCode || 200, result.headers || {})
    res.end(result.body)
  }
  return handler
}
