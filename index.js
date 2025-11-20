const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
require('dotenv').config()
const app = express()
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");


const port = process.env.PORT || 3000

function generateTrackingId() {
    const bytes = crypto.randomBytes(6); // returns a Buffer
    const hex = bytes.toString("hex").toUpperCase(); // converts buffer → hex string
    return "ZAP-" + hex;
}


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
        const paymentCollection = db.collection('payments');

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
            console.log('session', session)
            if (session.payment_status === 'paid') {
                const id = session.metadata.parcelId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId:generateTrackingId(),
                    }
                    
                }
                console.log('generated', generateTrackingId())
                const result = await parcelsCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail : session.customer_email,
                    parcelId: session.metadata.parcel,
                    parcelName :session.metadata.parcelName,
                    transactionId : session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt : new Date()
                    


                }

                if(session.payment_status==='paid'){
                    const resultPayment= await paymentCollection.insertOne(payment)
                    res.send({success:true, modifyParcel:result, paymentInfo: resultPayment})
                }
               
            }
            res.send({ success: false })
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
