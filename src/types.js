const gen = require('../../js-schema-gen') // require('@ipld/schema-gen')
const schema = require('./schema.json')

module.exports = (Block, codec) => {
  const types = gen(schema)
  return types
}
