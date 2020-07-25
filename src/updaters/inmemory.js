export default CID => {
  let current
  return {
    update: (_current, old) => {
      if (!old && !current) current = _current
      else if (current.equals(old)) current = _current
      return current
    },
    getRoot: () => current
  }
}
