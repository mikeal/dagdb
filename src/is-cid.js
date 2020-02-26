const cidSymbol = Symbol.for('@ipld/js-cid/CID')
const isCID = node => !!(node && node[cidSymbol])
module.exports = isCID
