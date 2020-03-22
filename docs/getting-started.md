# Getting Started

This tutorial will get you up and running with DagDB w/ JavaScript. If
you'd prefer to start with the command line head over to the [getting started
with the command line page]().

## Install

```
npm install dagdb
```

That's it.

## Create a database

```js
const dagdb = require('dagdb')
let db = await dagdb.create('dbname')
```

This creates a new databases. The above example is suitable for the browser, where `dbname`
is simply the name of the database and will be created in browser storage (IndexedDB).

In Node.js `dbname` is the path to a file or directory. See
[Node.js storage options](database/storage#nodejs) for details.

## Open a database

```js
let db = await dagdb.open('dbname')
```

## Live databases

A "live" database is a remote database that is cached locally. As you read and write
to the database it will pull data from the remote as needed. If the remote database
changes the live database will pull any updated data you had previously pulled from
the remote.

This is well suited for browsers, where local storage is limited and ultimately temporary. Since
the replication is effectively filtered based on what you've read, there's no need to
configure explicit data filters or design your database to be replicated to unique user
and device profiles.

```js
let db = await dagdb.live('https://storage.mysite.com/db')
```

To learn more about working with live databases head over to the
[live database](database/live) documentation.

## Reading and writing data

```js
await db.set('key', { hello: 'world' })
await db.get('key') // { hello: 'world' }
db = await db.update()
```

When you create or open a database the object you get is a database transaction. This instance
is permanently configured to the state of the database when you opened it. You can set new keys
and retrive both newly added keys and keys that are already in the database, but those keys
are not persisted into the database until it is commited (see [`.commit()`](under-the-hood/commits)).
The `update()` method commits the transaction and then updates the local HEAD to point to this
new commit.

The `.update()` method returns a *new* database transaction configured to the now commited
state of the database.

You can store anything that can be encoded as JSON as well as binary data and streams.

For more information on storing different data types move on to the [value types](database/values) page.
