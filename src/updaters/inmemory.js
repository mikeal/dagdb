class Inmem {
  update (_current, old) {
    if (!old && !this.current) this.current = _current
    else if (this.current.equals(old)) this.current = _current
    return this.current
  }

  get root () {
    return this.current
  }
}

const create = () => new Inmem()
export default create
