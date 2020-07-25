export default CID => {
  let current
  class Inmem {
    update (_current, old) {
      if (!old && !current) this.current = _current
      else if (this.current.equals(old)) this.current = _current
      return this.current
    }

    get root () {
      return this.current
    }
  }
  return new Inmem()
}
