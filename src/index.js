import bare from './bare.js'
import lfs from './stores/lfs.js'
import commit from './updaters/commit.js'
import fileUpdater from './updaters/file.js'

const mod = bare({ lfs, fileUpdater, commit })

export default mod
