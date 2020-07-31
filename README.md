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

### Opening a leveldown database

```js
import redisdown from 'redisdown' // Redis storage backend

const db = await dagdb.open({ leveldown: redisdown('location') })
```
