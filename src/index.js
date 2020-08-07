import Block from '@ipld/block/defaults.js'
import bare from './bare.js'
import lfs from './stores/lfs.js'
import fileUpdater from './updaters/file.js'

const mod = bare(Block, { lfs: lfs(Block), fileUpdater: fileUpdater(Block) })

export default mod
