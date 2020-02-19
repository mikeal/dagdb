# Key Value Database

```sh
type DeleteOperation struct {
  key String
}
type SetOperation struct {
  key String
  value Link
}
type Operation union {
  | SetOperation "set"
  | DeleteOperation "del"
} representation keyed

type OpList [&Operation]
type HAMT {String:Link}
type TransactionV1 struct {
  head HAMT
  ops OpList
  prev nullable Transaction
}
type Transaction union {
  | TransactionV1 "v1"
} representation keyed
```

The transaction head being a Map is a placeholder. Should be a HAMT.
