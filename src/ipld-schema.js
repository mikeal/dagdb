const types = {}
const strf = obj => JSON.stringify(obj)
const isCID = require('./is-cid')

const validateField = (api, key, schema, value) => {
  if (typeof value === 'undefined') {
    if (schema.optional) return
    throw new Error(`"${key}" is undefined`)
  }
  if (value === null) {
    if (schema.type === 'Null' || schema.nullable) return
    throw new Error(`Cannot be null "${key}"`)
  }
  if (typeof schema.type === 'string') {
  } else if (typeof schema.type === 'object') {
    if (schema.type.kind === 'link') {
      return api.Link.validate(value)
    }
    throw new Error('Unknown field type ' + strf(schema.type))
  }
  api[schema.type].validate(value)
  return value
}

class SchemaType {
  constructor (api, schema) {
    this.api = api
    this.schema = schema
  }
  static isNode = true
}
types.Map = class Map extends SchemaType {
  static kind = 'map'
  validate (obj) {
    if (typeof obj !== 'object') throw new Error('Must be object ' + strf(obj))
    if (!this.schema) return obj
    // TODO: accept Map objects and validate keys
    for (const [key, value] of Object.entries(obj)) {
      validateField(this.api, key, {type: this.schema.valueType}, value)
    }
    return obj
  }
}
types.Struct = class Struct extends SchemaType {
  static kind = 'struct'
  constructor (api, schema) {
    super(api, schema)
    this.representation = Object.keys(this.schema.representation)[0]
  }
  validate (obj) {
    switch (this.representation) {
      case "map": return this.validateMap(obj)
      default: throw new Error('Unknown representation ' + strf(this.schema.representation))
    }
  }
  validateMap (obj) {
    for (const [key, schema] of Object.entries(this.schema.fields)) {
      validateField(this.api, key, schema, obj[key])
    }
    return obj
  }
}
types.Union = class Union extends SchemaType {
  static kind = 'union'
  constructor (api, schema) {
    super(api, schema)
    this.representation = Object.keys(this.schema.representation)[0]
  }
  validate (obj) {
    switch (this.representation) {
      case "keyed": return this.validateKeyed(obj)
      default: throw new Error('Unknown representation ' + strf(this.schema.representation))
    }
  }
  validateKeyed (obj) {
    const schema = this.schema.representation.keyed
    const key = Object.keys(obj)[0]
    if (!schema[key]) throw new Error(`Unknown union key "${key}"`)
    const name = schema[key]
    if (!this.api[name]) throw new Error(`Missing type named "${name}"`)
    this.api[name].validate(obj[key])
    return obj
  }
}
types.List = class List extends SchemaType {
  static kind = 'list'
  validate (obj) {
    if (!Array.isArray(obj)) throw new Error('Not encoded as list ' + strf(obj))
    if (!this.schema) return obj
    let i = 0
    for (const value of obj) {
      i++
      validateField(this.api, i, {type: this.schema.valueType}, value)
    }
    return obj
  }
}
types.String = class String extends SchemaType {
  static kind = 'string'
  validate (obj) {
    if (typeof obj !== 'string') throw new Error('Must be string ' + strf(obj))
    return obj
  }
}
types.Link = class Link extends SchemaType {
  static kind = 'link'
  validate (obj) {
    if (!isCID(obj)) throw new Error('Not a valid link ' + strf(obj))
    return obj
  }
}

const kinds = {}
for (const [, CLS] of Object.entries(types)) {
  kinds[CLS.kind] = CLS
}

const addSchemas = (api, ...schemas) => {
  api.String = new types.String(api)
  api.List = new types.List(api)
  api.Map = new types.Map(api)
  api.Link = new types.Link(api)
  for (const parsed of schemas) {
    for (const [key, schema] of Object.entries(parsed.types)) {
      if (api[key]) throw new Error('Cannot create duplicate type: ' + key)
      if (!schema.kind) throw new Error('Not implemented')
      const CLS = kinds[schema.kind]
      if (!CLS) throw new Error('No kind named "' + schema.kind + '"')
      api[key] = new CLS(api, schema)
      api[key].name = key
    }
  }
  const ret = (value, typeName) => {
    if (!api[typeName]) throw new Error(`No type named "${typeName}"`)
    const v = api[typeName].validate(value)
    if (value !== v) throw new Error("Uh oh! There's a bug in the schema validator, sorry.")
    return v
  }
  ret.addSchemas = (...schemas) => addSchemas(api, ...schemas)
  return ret
}
const create = (...schemas) => {
  return addSchemas({}, ...schemas)
}
module.exports = create
