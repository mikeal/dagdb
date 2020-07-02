import path from 'path'
import tmp from 'tmp'
import { spawn as _spawn } from 'child_process'
import { promises as fs } from 'fs'

const { stat } = fs
const dir = tmp.dirSync({ prefix: 'dagdb-tests-' }).name

const concat = arr => Uint8Array.from([].concat(...arr.map(a => Array.from(a))))

const spawn = (...args) => new Promise((resolve, reject) => {
  const handle = _spawn(...args)
  const stdout = []
  const stderr = []
  const str = arr => concat(arr).toString()
  handle.stdout.on('data', chunk => stdout.push(chunk))
  handle.stderr.on('data', chunk => stderr.push(chunk))
  handle.on('exit', code => {
    resolve({ code, stdout: str(stdout), stderr: str(stderr) })
  })
  handle.on('error', reject)
})

const cli = path.normalize(path.join(__dirname, '../../cli.js'))

exports.init = async () => {
  const dbfile = path.join(dir, Math.random().toString() + '.dagdb.car')
  const dbarg = `--dbfile=${dbfile}`
  const initOutput = await spawn(cli, ['init', dbarg])
  const _stat = await stat(dbfile)
  const run = async (...args) => {
    console.log({ cli, args: [...args, dbarg] })
    const outs = await spawn(cli, [...args, dbarg])
    if (outs.code) throw new Error('Non-zero exit code.\n' + outs.stderr)
    return outs
  }
  return { spawn, run, stat: _stat, dbfile, dbarg, initOutput, dir }
}
