import lfs from 'lfs-store'
import getRepo from 'git-remote-origin-url'

const getUser = str => {
  str = str.slice(0, str.lastIndexOf('/'))
  return str.slice(str.lastIndexOf('/') + 1)
}

export default Block => {
  return async (filepath = './blockstore.ipld-lfs', repo, user, token) => {
    if (!repo) repo = await getRepo()
    if (!user) user = process.env.GITHUB_ACTOR || getUser(repo)
    if (!token) token = process.env.GHTOKEN || process.env.GITHUB_TOKEN
    lfs(Block, filepath, repo, user, token)
  }
}
