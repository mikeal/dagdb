# DagDB

DagDB is a flexible database for distributed applications.

It can store JSON, binary, and even streams of binary. You can nest
these values withn each other or create links between pieces of data for
efficiency and de-duplication. You can even next databases inside of other
databases. This gives you the flexibility
to assemble incredibly large and efficient graphs of information while
still being able to perform efficient transactions no matter how large
these graphs become.

DagDB has decentralized replication that works very similar to git. The
vast majority of merge conflicts can be handled automatically and you
can even merge several databases from different users into a single database.

It works in browsers, Node.js, and can be deployed to any cloud environment
with little more than basic storage (S3). It even runs in "Serverless"
environments like Lambda.

The primitives used in DagDB are also well suited to CDN's and other edge
caching solutions.

```js
const dagdb = require('dagdb')
let db = await dagdb.create()
await db.set('key', { hello: 'world' })
db = await db.update()
```

To learn more, move along to the [Getting Started](getting-started) section.
