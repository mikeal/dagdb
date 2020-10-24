import { validate } from 

const fromBlock = (block, className) => validate(block.decode(), className)

const toBlock = (value, className) => Block.encoder(validate(value, className), 'dag-cbor')

export { toBlock, fromBlock }
