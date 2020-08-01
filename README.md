# DagDB

***This project is pre-release, do not use it in production, breaking
changes may still occur without notice.***

DagDB is a portable and syncable database for the Web.

It can run as a distrubuted database in Node.js, including Serverless
environments using AWS services as a backend.

It also runs in the browser. In fact, there is no "client and server"
in DagDB, everything is just a DagDB database replicating from another
database. In this way, it's closer to `git` than a traditional database
workflow.

## Creating Databases

At an abstract level, DagDB databases operate on top of two storage interfaces.
The first is the **block store**, which is a relatively simple key/value store.
The second is an **updater** which is a single mutable reference to the current
root of the database.

The following methods are available to simplify the process of creating a new
database on a number of storage and updater backends.

### Create an in-memory database.

```js
import dagdb from 'dagdb'

const db = await dagdb.create('inmem') /* 'inmemory' also works */
```

### Create a database in S3

```js
import dagdb from 'dagdb'
import { S3 } from 'aws-sdk'

const Bucket = 'bucketName'
const s3 = new S3({ params: { Bucket } })

let db = await dagdb.create({ s3 })
```

This uses S3 for block storage and for the update transaction. This will work fine as long as you
don't try to update the same database with a lot of concurrency, then you might encounter eventually
consistency issues w/ S3. An updater built on top of Dynamo that can do transactional updates is
planned in order to resolve these concerns.

### Create a database from a leveldown interface.

This allows you to store DagDB data in a
[wide variety of storage backends](https://nicedoc.io/Level/awesome#stores).

```js
import memdown from 'memdown'

const leveldown = memdown(Math.random().toString()) // memdown takes a unique identifier
const db = await dagdb.create({ leveldown })
```

### Create a database at a remote URL (no local caching or storage).

```js
const db = await dagdb.create('http://website.com/dbname')
```

## Opening a Database

### Opening a remote database

```js
import dagdb from 'dagdb'

const db = await dagdb.open('http://website.com/dbname')
```

### Create a database in S3

```js
import dagdb from 'dagdb'
import { S3 } from 'aws-sdk'

const Bucket = 'bucketName'
const s3 = new S3({ params: { Bucket } })

let db = await dagdb.open({ s3 })
```

### Opening a leveldown database

```js
import redisdown from 'redisdown' // Redis storage backend

const db = await dagdb.open({ leveldown: redisdown('location') })
```

## Key Value Storage

DagDB's primary storage system is a simple key-value store. Keys
can be any string, and values can be almost anything.

For instance, all JSON types are natively supported as values.

```js
let db = await dagdb.create('inmem')
await db.set('hello', 'world')
console.log(await db.get('hello'))
// prints "world"
```

As you can see, you can set and get values immediately. Something to
note about this example is that, while the `"hello"` key is available,
it is actually coming out of a staging area that has not yet been committed
to the database.

Every instance of `DagDB` is bound to an **immutable** database state.
We then add, remove, or change keys in that database until finally
updating it, which will return us a ***new*** `DagDB` instance
for the newly updated immutable state.

```js
let db = await dagdb.create('inmem')
await db.set('hello', 'world')
db = await db.update()
console.log(await db.get('hello'))
// prints "world"
```

Now that we know how to set values and update the database lets work
with some more advanced values.

```js
const now = new Date()
await db.set('big-value', {
  name: 'Mikeal Rogers',
  created: {
    year: now.getYear(),
    month: now.getMonth(),
    day: now.getDay()
  },
  hobbies: [ 'code', 'food', 'tea' ]
})
```

As you can see, we can use all JSON types and there's no limit to how far we
can nest values inside of objects. In addition to JSON types we support efficient
binary serialization, so you can use `Uint8Array` for any binary you have.

### Links

So far we haven't shown you anything you can't do with any other key-value store.
Now let's look at some features unique to DagDB and the primitives it's built on.

```js
const link = await db.link({ name: 'Earth', size: 3958.8 })
await db.set('mikeal', { name: 'Mikeal Rogers', planet: link })
await db.set('chris', { name: 'Chris Hafey', planet: link })
db = db.update()

const howBigIsYourPlanet = async key => {
  const person = await db.get(key)
  const planet = await person.planet()
  console.log(`${person.name} lives on a planet w/ a radius of ${planet.size}mi`)
}
await howBigIsYourPlanet('mikeal')
// prints "Mikeal Rogers lives on a planet w/ a radius of 3958.8mi"
await howBigIsYourPlanet('chris')
// prints "Chris Hafey lives on a planet w/ a radius of 3958.8mi"
```

Pretty cool!

As you can see, link values are decoded by DagDB as async functions that will
return the decoded value from the database.

The great thing about links is that the data is de-duplicated across the database.
DagDB uses a technique called "content addressing" that links data by hashing the
value. This means that, even if you create the link again with the same data, the
link will be the same and the data will be deduplicated.

You can also compare links in order to tell if they refer to the same data.

```js
const link1 = await db.link({ name: 'Earth', size: 3958.8 })
const link2 = await db.link({ name: 'Earth', size: 3958.8 })
console.log(link1.equals(link2))
// prints true

const samePlanet = async (key1, key2) => {
  const person1 = await db.get(key1)
  const person2 = await db.get(key2)
  if (person1.planet.equals(person2.planet)) {
    console.log(`${person1.name} is on the same planet as ${person2.name}`)
  } else {
    console.log(`${person1.name} is not on the same planet as ${person2.name}`)
  }
}
samePlanet('mikeal', 'chris')
// prints "Mikeal Rogers is on the same planet as Chris Hafey"
```

As you can see, links are more than addresses, they are useful values for comparison.

There's no limit to the number of links and the depth at which you nest your values.
Most importantly, you can use linked data in any other value with zero copy overhead,
it's just a simple small update to the link value.

### Streams

Since it is often problematic to store large amounts of binary as a single value, DagDB
also natively supports storing streams of binary data.

DagDB treats **any async generator** as a binary stream. Node.js Streams are valid
async generators so they work right away.

```js
import { createReadStream } from 'fs'

const reader = createReadStream('/path/to/file')

db = await db.set('my file', { file: reader }).update()

const printFile = async (key, property) => {
  const value = await db.get(key)
  for await (const chunk of value[property]) {
    process.stdout.write(chunk)
  }
}
printFile('my file', 'file')
```

Note that, while you can use any Stream interface that is a valid async generator (like Node.js
Streams) to store the data, when you retieve the stream it will be returned as a common async
generator (not a Node.js Stream).

The size of every chunk in the stream is preserved. However, *this may change in the future*.
Some transports have issues with block sizes larger than 1mb so we may change the defaults
in the future to keep each chunk below 1mb.

### Nesting Databases

Another really cool think you can do is use DagDB's as values in other databases.

```js
let db1 = await dagdb.create('inmem')
let db2 = await dagdb.create('inmem')

db1 = await db1.set('hello', 'world').update()
db2 = await db2.set('db1', db1).update()

const db = await db2.get('db1')
console.log(await db.get('hello'))
// prints "world"
```

This feature uses a very flexible system that can be extended in the future to feature
all kinds of new data types.

## Replication

Replication in DagDB is quite different than traditional databases. Since there isn't a client
and a server, since there's just databases everywhere, replication is a key component of how
you access data.

The closest thing to DagDB replication you're familiar with is `git`. The way changes are merged
from one branch to another and from one remote to another. We even have a system for keeping track
of remote databases that feels a lot like git.

Let's start by adding and pulling from a remote.

```js
const url = 'http://website.com/db'
const remoteDatabase = await dagdb.create(url)
await remoteDatabase.set('hello', 'world').update()

let db = dagdb.create('inmem')
await db.remotes.add('web', url)

await db.remotes.pull('web')
db = await db.update()

console.log(await db.get('hello'))
// prints "world"
```

Using remotes for replication is an efficient way to move data around because it keeps track
of the last changeset and can easily pull only the changes since that time. However, if you
have two data instances locally you can easily merge one into the other without using the
remote system.

```js
let db1 = await dagdb.create('inmem')
let db2 = await dagdb.create('inmem')

db1 = await db1.set('hello', 'world').update()
db2 = await db2.merge(db1).update()

console.log(await db2.get('hello'))
// prints "world"
```

### Replicate remote to key

So far, we've been using replication to merge an entire database's keyspace into our own.
But as we've already seen, you can use a DagDB database as a value, so it would make sense
to use a remote to replicate into a key rather than merging into our entire local namespace.

```js
const url = 'http://website.com/db'
const remoteDatabase = await dagdb.create(url)
await remoteDatabase.set('hello', 'world').update()

let db = dagdb.create('inmem')
await db.remotes.add('web', { source: url, strategy: { keyed: 'webdb' }})

await db.remotes.pull('web')
db = await db.update()
const webdb = await db.get('webdb')

console.log(await webdb.get('hello'))
// prints "world"
```

## Running the HTTP Service

### in Node.js

If you're using Node.js it's quite easy to get an HTTP handler you can
pass to `http.createServer` for any database instance.

```js
import http from 'http'
import dagdb from 'dagdb'
import createHandler from 'dagdb/server.js'

const db = await dagdb.create('inmem')
const handler = createHandler(db)

const server = http.createServer(handler)
server.listen(8080)
```

