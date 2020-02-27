# Ideas

Still very much in the "ideas phase."

A few features that we get "for free" from the primitives.

* Graphs of indefinite size attached to any value.
* Selectors for querying.
* Offline.
* Cachability (every state and query can be cached by hash)
* Partial "just-in-time" replication
  * This means that, as you read data you store that data for offline access. You can then
    check for updates to the paths that you've traversed, so the sync and offline profile
    does not need to be created ahead of time, it just follows the paths you read into.

What needs to be built is:

* [x] Multi-block un-ordered store.
  * This can be built on a HAMT, but needs to use the block's CID as the key.
* [ ] Sorted multi-block index(s)
  * This has not been built, and differnet key types will need different indexes. Timerange
    indexes can be very well optimized, especially when inserts are primarily to new times.
* [x] Schemas for transactions and a basic chain for databases and indexes.
  * [x] Each transaction is a unique block.
  * [x] The head of a database is a list of transactions, the head of the prior database, and the root of the new HAMT
    after applying the transactions.
    * This means that any head can be compared to another head, their transactions compared, and re-run against each other. 
  * If we define indexes by associating a selector to the key then we can define the index head as
    the pairing of the root of the database, the key selector, the index type/algorithm, and the head of the index.
