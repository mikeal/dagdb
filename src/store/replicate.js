const CID = require('cids')

const replicate = async (cid, _from, _to, depth, batchSize = 100, skip = new Set()) => {
  let { complete, missing, incomplete } = await _to.graph(cid)
  if (complete) return { complete: true }
  for (const key of skip) {
    if (missing.has(key)) missing.delete(key)
    if (incomplete.has(key)) incomplete.delete(key)
  }
  if (depth === 0) return { missing, incomplete }
  incomplete = Array.from(new Set([...missing, ...incomplete]))
  const _localMissing = []
  const push = async cid => {
    skip.add(cid)
    let block
    try {
      block = await _from.get(new CID(cid))
    } catch (e) {
      if (e.status !== 404) throw e
      _localMissing.add(cid)
      incomplete.delete(cid)
      return
    }
    return _to.put(block)
  }
  while (missing.length) {
    await Promise.all(missing.splice(0, batchSize).map(push))
  }
  let results = []
  while (incomplete.length) {
    const _depth = typeof depth === 'undefined' ? depth : depth - 1
    const batch = incomplete.splice(0, batchSize).map(c => replicate(new CID(c), _from, _to, _depth, batchSize, skip))
    results = [...results, ...Promise.all(batch)]
  }
  let _missing = []
  let _incomplete = []
  for (const result of results) {
    if (result.missing) _missing = [..._missing, ...result.missing]
    if (result.incomplete) _incomplete = [..._incomplete, ...result.incomplete]
  }
  if (_missing.size === 0 && _incomplete.size === 0 && _localMissing.size === 0) return { complete }
  return { missing: _missing, incomplete: _incomplete, localMissing: _localMissing }
}
module.exports = replicate
