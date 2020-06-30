/* globals describe, it */
// DAGDB_TEST_BUCKET=dagdb-test mocha test/scripts/test-s3.js -b --timeout=5000
import { graphTests, replicateTests, basics } from '../lib/storage.js'
import Block from '@ipld/block/defaults.js'

import createS3Store from '../../src/store/s3.js'
import createStore = createS3Store(Block)
import { S3 } from 'aws-sdk'
import awsConfig from 'aws-config'

const test = it

if (!process.env.DAGDB_TEST_BUCKET) {
  throw new Error('Missing env variable $DAGDB_TEST_BUCKET')
}

const create = () => {
  const id = Math.random().toString()
  const keyPrefix = id + '/'
  const Bucket = process.env.DAGDB_TEST_BUCKET
  const s3 = new S3({ ...awsConfig(), params: { Bucket } })
  return createStore(s3, { keyPrefix })
}

describe('s3', () => {
  test('basics', async () => {
    await basics(create)
  })
  describe('graph', () => {
    graphTests(create, (store, ...args) => store.graph(...args))
  })
  describe('replicate', () => {
    replicateTests(create)
  })
})
