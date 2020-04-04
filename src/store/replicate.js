const CID = require('cids')

const replicate = async (cid, _from, _to, depth, batchSize = 100, skip = new Set()) => {
  let { complete, missing, incomplete } = await _to.graph(cid, depth)
  if (complete) return { complete }
  if (!incomplete) incomplete = new Set()
  if (!missing) missing = new Set()
  for (const key of skip) {
    missing.delete(key)
    incomplete.delete(key)
  }
  if (depth === -1) {
    return {
      missing: missing.size ? missing : undefined
      // incomplete: incomplete.size ? incomplete : undefined
    }
  }
  const push = async key => {
    skip.add(key)
    let block
    try {
      block = await _from.get(new CID(key))
    } catch (e) {
      if (e.status !== 404) throw e
      missing.add(key)
      return
    }
    incomplete.add(key)
    return _to.put(block)
  }
  const gets = [...missing.values()]
  missing = new Set()
  while (gets.length) {
    await Promise.all(gets.splice(0, batchSize).map(push))
  }
  for (const key of [...incomplete.values()]) {
    incomplete.delete(key)
    const _depth = depth - 1
    const result = await replicate(new CID(key), _from, _to, _depth, batchSize, skip)
    if (result.complete) continue
    else {
      if (result.missing) {
        for (const key of result.missing.values()) {
          missing.add(key)
        }
      }
      /*
      if (result.incomplete) {
        for (const key of result.incomplete.values()) {
          incomplete.add(key)
        }
      }
      */
    }
  }
  if (!missing.size && !incomplete.size) return { complete: true }
  return {
    missing
    // missing: missing.size ? missing : undefined,
    // incomplete: incomplete.size ? incomplete : undefined
  }
}
module.exports = replicate
