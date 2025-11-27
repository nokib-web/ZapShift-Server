const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
require('dotenv').config()
const app = express()
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");
const admin = require("firebase-admin");

const serviceAccount = require("./zapshift-firebase-adminsdk.json");

const port = process.env.PORT || 3000


admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
    const bytes = crypto.randomBytes(6); // returns a Buffer
    const hex = bytes.toString("hex").toUpperCase(); // converts buffer → hex string
    return "ZAP-" + hex;
}


// middleware
app.use(express.json());
app.use(cors())

const verifyFBToken = async (req, res, next) => {
    // console.log("headers in the middleware",req.headers.Authorization)
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken)
        req.decoded_email = decoded.email;
        console.log('decoded dta', decoded)

    }
    catch (err) {
        return res.status(401).send({ message: "unauthorized access" })
    }


    next()
}

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
        const userCollection = db.collection("users");
        const riderCollection = db.collection("riders")
        const parcelsCollection = db.collection("parcels");
        const paymentCollection = db.collection('payments');

        // Users related api

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();

            const email = user.email
            const userExist = await userCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'user already exist' })
            }
            const result = await userCollection.insertOne(user);
            res.json(result); // json => send
        })

        // Riders related api

        // Get rider
        app.get('/riders', async (req, res) => {
            const query = {}
            if (req.query.status) {
                query.status = req.query.status
            }
            const cursor = riderCollection.find(query)
            const result = await cursor.toArray()
            res.json(result)
        })

        // Create rider
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            rider.status = 'pending';
            rider.createdAt = new Date();


            const email = rider.email
            const riderExist = await riderCollection.findOne({ email })
            if (riderExist) {
                return res.status(409).json({ message: 'rider already exist' })
            }


            const result = await riderCollection.insertOne(rider);
            res.json(result);
        })

        // update rider

        app.patch('/riders/:id', verifyFBToken, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: status
                }
            }

            const result = await riderCollection.updateOne(query, updatedDoc)
            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'rider'
                    }
                }

                const userResult = await userCollection.updateOne(userQuery, updateUser)
            }
            res.json(result)

        })

        // Delete a Rider application 
        // DELETE a rider by ID
        app.delete("/riders/:id", verifyFBToken, async (req, res) => {
            try {
                const id = req.params.id;

                const query = { _id: new ObjectId(id) };
                const result = await riderCollection.deleteOne(query);

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                res.send({ success: true, deleted: result });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal Server Error", error: error.message });
            }
        });


        // get by id Api
        app.get('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const parcel = await parcelsCollection.findOne(query);
            res.send(parcel);
        });


        // parcel get api
        app.get('/parcels', async (req, res) => {
            const query = {};
            const { email } = req.query;
            if (email) {
                query.senderEmail = email;
            }

            const options = {
                sort: { createdAt: -1 },
            };
            const parcels = await parcelsCollection.find(query, options).toArray();
            res.send(parcels);
        });

        // parcel post api
        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            // parcel createdAt
            parcel.createdAt = new Date();
            const result = await parcelsCollection.insertOne(parcel);
            res.send(result);
        });

        // Parcel delete api
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await parcelsCollection.deleteOne(query);
            res.send(result);
        });


        // Payments Related api
        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}

            console.log(req.headers)

            if (email) {
                query.customerEmail = email
                // check email address
                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: "forbidden access" })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray();
            res.send(result);
        });



        // payment related api


        // Payment checkout
        app.post('/payment-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: ` Please pay for: ${paymentInfo.parcelName}`,
                            }
                        },


                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                    parcelName: paymentInfo.parcelName
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
            })
            console.log(session)
            res.send({ url: session.url })
        })



        // old
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: ` Please pay for: ${paymentInfo.parcelName}`,
                            }
                        },

                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.senderEmail,
                mode: 'payment',
                metadata: {
                    parcelId: paymentInfo.parcelId,
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-canceled`,
            })
            console.log(session)
            res.send({ url: session.url })
        })

        // payment success api
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query);
            console.log(paymentExist)
            if (paymentExist) {
                return res.send({
                    message: 'already exist',
                    transactionId,
                    trackingId: paymentExist.trackingId
                })
            }

            const trackingId = generateTrackingId()
            console.log('session', session)
            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                    }

                }
                console.log('generated', generateTrackingId())
                const result = await parcelsCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    parcelId: session.metadata.parcel,
                    parcelName: session.metadata.parcelName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId,




                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment)
                    return res.send({
                        success: true,
                        modifyParcel: result,
                        paymentInfo: resultPayment,
                        transactionId: session.payment_intent,
                        trackingId: trackingId
                    })
                }

            }
            return res.send({ success: false })

        })




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
