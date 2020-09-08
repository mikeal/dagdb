import Block from '@ipld/block/defaults'
import bare from './bare.js'
import lfs from './stores/lfs.js'
import commit from './updaters/commit.js'
import fileUpdater from './updaters/file.js'

const mod = bare(Block, { lfs: lfs(Block), fileUpdater: fileUpdater(Block), commit })

export default mod
