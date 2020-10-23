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
  | TransactionV1 "kv-v1"
} representation keyed
```
# Indexes

```sh
type PropIndex struct {
  count int
  sum int
  map &HashMapRoot # map of { DBKey: PropValue }
}
type Props { String: &PropIndex }
type Indexes struct {
  props &Props
}
```

# DagDB Type

This is a massive union of all the publicly visible types used by
DagDB. There are many points where **any** of these types can be
used as a value. For instance, a `Database` can also be used as
a value almost anywhere and will be cast into the correct class
instance when retrieved by user facing APIs.

```sh
type DagDBTypeV1 union {
  | &Database "database"
  | &Transaction "transaction"
  | &FlexibleByteLayout "fbl"
} representation keyed

type DagDBType union {
  | DagDBTypeV1 "v1"
} representation keyed

type DagDB struct {
  type DagDBType (rename "_dagdb")
}
```

DagDB's value loader walks decoded blocks and replaces the referenced
values with instances of the relevant types and validates them against
the referenced schemas. This effectively means that `"_dagdb"` is a
reserved key *at any depth* with very few exceptions.

# Remote

```sh
type FullMerge bool # must be true
type KeyedMerge string
type RemoteMergeStrategy union {
  | FullMerge "full"
  | KeyedMerge "keyed"
} representation keyed

type RemoteSource struct {
  type String
}

type RemoteInfo struct {
  strategy RemoteMergeStrategy
  source RemoteSource
}

type Remote struct {
  info &RemoteInfo
  head &HashMapRoot # remote KV root
  merged &HashMapRoot # local KV root
}
```

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
type DatabaseV1 struct {
  kv &Transaction
  indexes &Indexes # Values type is Index
  remotes &HashMapRoot # Values type is Remote
}

type Database union {
  | DatabaseV1 "db-v1"
} representation keyed
```

`tags` is a key/value pairing of the named key to the
transaction root of related kv store.

`actions` is a key/value pairing of a tag name to
related actions. Each action is also named, so the
value here is a HashMapRoot.
