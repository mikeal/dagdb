import { encode, decode, create as _create } from 'multiformats/block'
import * as codec from '@ipld/dag-cbor'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import schema from './schema.js'
import createValidate from '@ipld/schema-validation'

const validate = createValidate(schema)

const fromBlock = (block, className) => validate(block.decode(), className)

const toBlock = (value, className) => {
  validate(value, className)
  encode({ value, codec, hasher })
}

const encoder = value => encode({ value, hasher, codec })
const decoder = bytes => decode({ bytes, hasher, codec })
const create = ({ cid, bytes }) => _create({ cid, bytes, hasher, codec })

export { toBlock, fromBlock, encoder, decoder, validate, create }
