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
    if (parsed.searchParams.has('depth')) {
      params.depth = parseInt(parsed.searchParams.get('depth'))
    }
    const [method, path] = [req.method, req.url]
    const result = await _handler({ method, path, params, body })
    res.writeHead(result.statusCode || 200, result.headers || {})
    res.end(result.body)
  }
  return handler
}
