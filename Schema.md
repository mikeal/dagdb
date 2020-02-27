# [HAMT](https://github.com/ipld/specs/blob/master/data-structures/hashmap.md)

This schema is only here for reference. It's not actually verified or validated
by this library because we use [an existing implementation](https://github.com/rvagg/iamap).

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

# Secondary Key Value Index

This is just a HAMT built from a path read on a primary store.

Essentially, it provides a secondary key lookup that returns as many
values as match the path value.

```sh
type SecondaryKeyValueIndex struct {
  path String
  head &Transaction
  index &HashMapRoot
  rmap &HashMapRoot
}
```

`head` is the DagDB transaction head for the primary store.

`index` is the stored secondary index. The key being the secondary
key and the value being *another* HashMapRoot. The keys in the final
HAMT are the keys from the original data pointing at the full value.

`rmap` is a HAMT that maps the primary key data to the resolved secondary
index. This way, if the value for the secondary index is modified or the
value removed from the primary store the index can be updated to reflect
the new state. The keys are multibase(base64) cid's of the original data
and the value is the string value for the secondary index key.

# Database

A `Store` is a set of `Key Value Database`'s.

One is a set of Tags, the other stores actions
attached to each of those tags.

Actions are anything that is triggered or built
from the data associated with the named tags, like
secondary indexes.

Typically, actions are not pushed to a remote, they are local
to the device/store. Tags typically **are** pushed to a remote.

```sh
type Action union {
  | SecondaryKeyValueFilter "skvf"
} representation keyed

type DatabaseV1 struct {
  tags &Transaction
  actions &Transaction
}

type Database union {
  | DatabaseV1 "v1"
} representation keyed
```

`tags` is a key/value pairing of the named key to the
transaction root of related kv store.

`actions` is a key/value pairing of a tag name to
related actions. Each action is also named, so the
value here is a HashMapRoot.
