/* globals it, describe */
import index from '../src/index.js'
import browser from '../src/browser.js'
import assert from 'assert'

const test = it
const same = assert.deepStrictEqual

describe('test-imports', () => {
  test('default create', async () => {
    const db = await index.create('inmem')
    same(await db.info(), { size: 0 })
  })

  if (process.browser) {
    test('browser create', async () => {
      const db = await browser.create({ browser: true })
      same(await db.info(), { size: 0 })
    })
  }
})
