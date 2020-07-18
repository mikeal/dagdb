export default schema => {
  let required = []
  for (const [key, value] of Object.entries(schema)) {
    if (value === null) {
      schema[key] = { default: null }
      continue
    }
    if (typeof value === 'boolean') {
      schema[key] = { default: value, type: Boolean }
    } else if (typeof value === 'object') {
      if (!value.default) {
        required = [...required, [key, ...(value.aliases || [])]]
      }
      if (value.aliases) {
        value.name = key
        value.aliases.forEach(k => { schema[k] = value })
      }
    }
  }
  return async argv => {
    argv = [...argv]
    const args = { args: [], _schema: schema, _required: required }
    for (const [key, value] of Object.entries(schema)) {
      console.log({key, value})
      if (value && typeof value === 'object' && typeof value.default !== 'undefined') {
        args[key] = value.default
      }
    }
    if (argv.includes('--')) {
      const i = argv.indexOf('--')
      args['--'] = argv.slice(i + 1)
      argv = argv.slice(0, i)
    }
    const handle = async (k, v) => {
      if (!schema[k]) {
        if (typeof v === 'undefined') v = true
        args[k] = v
        return
      }
      const name = schema[k].name || k
      const { type, transform } = schema[name]
      if (transform) {
        v = await transform(v)
      } else if (type === Boolean) {
        if (v === 'true' || v === 'false') {
          v = JSON.parse(v)
        } else {
          throw new Error('Invalid boolean value')
        }
      }
      if (type && !(v instanceof type)) {
        throw new Error(`Invalid type. ${name} must be of type ${type}`)
      }
      args[name] = v
    }
    const promises = []
    while (argv.length) {
      let part = argv.shift()
      if (part.startsWith('--')) {
        part = part.slice(2)
        if (part.includes('=')) {
          const [k, v] = part.slice('=')
          promises.push(handle(k, v))
        } else {
          const value = argv.shift()
          promises.push(handle(part, value))
        }
      } else if (part.startsWith('-')) {
        part = part.slice(1)
        if (part.length === 1 && schema[part] && schema[part].type !== 'Boolean' &&
             argv.length && !argv[0].startsWith('-')) {
          promises.push(handle(part, argv.shift()))
          continue
        }
        for (const alias of part.split('')) {
          let value
          if (schema[alias] && schema[alias].default && typeof schema[alias].default === 'boolean') {
            value = !schema[alias].default
          } else {
            value = true
          }
          promises.push(handle(alias, value))
        }
      } else {
        args.args.push(part)
      }
    }
    return args
  }
}
