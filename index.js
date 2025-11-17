const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000

// middleware
app.use(express.json());
app.use(cors())

const uri = process.env.MongoDB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


app.get('/', (req, res) => {
    res.send('zap is running')
})

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("ZapShift");
        const usersCollection = db.collection("users");
        const parcelsCollection = db.collection("parcels");

        // parcel post api
        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            const result = await parcelsCollection.insertOne(parcel);
            res.send(result);
        });

        // parcel get api
        app.get('/parcels', async (req, res) => {
            const query = {};
            const { email } = req.query;
            if (email) {
                query.senderEmail = email;
            }
            const parcels = await parcelsCollection.find(query).toArray();
            res.send(parcels);
        });




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
       
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
