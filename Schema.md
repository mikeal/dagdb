# [HAMT](https://github.com/ipld/specs/blob/master/data-structures/hashmap.md)

```sh
type HashMapData [Element]
type HashMapRoot struct {
  hashAlg String
  bucketSize Int
  map Bytes
  data HashMapData
}

# Non-root node layout
type HashMapNode struct {
  map Bytes
  data HashMapData
}

type Element union {
  | HashMapNode map
  | &HashMapNode link
  | Bucket list
} representation kinded

type Bucket [ BucketEntry ]

type BucketEntry struct {
  key Bytes
  value Value
} representation tuple

type Value union {
  | Bool bool
  | String string
  | Bytes bytes
  | Int int
  | Float float
  | Map map
  | List list
  | Link link
} representation kinded
```

# Key Value Database

```sh
type DeleteOperation struct {
  key String
}
type SetOperation struct {
  key String
  val Link
}
type Operation union {
  | SetOperation "set"
  | DeleteOperation "del"
} representation keyed

type OpList [&Operation]
type TransactionV1 struct {
  head &HashMapRoot
  ops OpList
  prev nullable &Transaction
}
type Transaction union {
  | TransactionV1 "v1"
} representation keyed
```

The transaction head being a Map is a placeholder. Should be a HAMT.
