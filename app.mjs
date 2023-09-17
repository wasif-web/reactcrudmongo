import express from "express";
import { customAlphabet } from 'nanoid';
import { MongoClient, ObjectId } from "mongodb";
// import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { PineconeClient } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import dotenv from 'dotenv';

// const __dirname = path.resolve();

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const mongodbURI =  `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.zttuzw8.mongodb.net/?retryWrites=true&w=majority`;
// `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.zttuzw8.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(mongodbURI);
const database = client.db('socialstories');
const postCollection = database.collection('posts');

async function run() {
  try {
    await client.connect();
    await client.db("socialstories").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.error);

const pinecone = new PineconeClient();

(async () => {
  try {
    await pinecone.init({
      environment: process.env.PINECONE_ENVIRONMENT,
      apiKey: process.env.PINECONE_API_KEY,
    });
  } catch (error) {
    console.error("Pinecone initialization error:", error);
  }
})();

const app = express();
app.use(express.json());
app.use(cors());
// app.use(morgan('combined'));

app.get("/api/v1/stories", async (req, res) => {
  const cursor = postCollection
    .find({})
    .sort({ _id: -1 })
    .project({ plot_embedding: 0 });

  try {
    const allStories = await cursor.toArray();
    res.send(allStories);
  } catch (error) {
    console.error("Error getting stories:", error);
    res.status(500).send({ message: "Failed to get stories, please try later" });
  }
});

app.get("/api/v1/search", async (req, res) => {
  const queryText = req.query.q;

  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: queryText,
  });
  const vector = response?.data[0]?.embedding;

  const documents = await postCollection.aggregate([
    {
      "$search": {
        "index": "default",
        "knnBeta": {
          "vector": vector,
          "path": "plot_embedding",
          "k": 5
        },
        "scoreDetails": true
      }
    },
    {
      "$project": {
        "plot_embedding": 0,
        "score": { "$meta": "searchScore" },
        "scoreDetails": { "$meta": "searchScoreDetails" }
      },
    }
  ]).toArray();

  res.send(documents);
});

app.post("/api/v1/story", async (req, res) => {
  try {
    const doc = {
      title: req?.body?.title,
      body: req?.body?.body,
      $currentDate: {
        createdOn: true
      },
    };

    const result = await postCollection.insertOne(doc);
    console.log("result: ", result);
    res.send({
      message: "Story created successfully"
    });
  } catch (error) {
    console.error("Error creating story:", error);
    res.status(500).send({ message: "Failed to add, please try later" });
  }
});

app.put("/api/v1/story/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(403).send({ message: "Incorrect story id" });
    return;
  }

  let story = {};

  if (req.body.title) story.title = req.body.title;
  if (req.body.body) story.body = req.body.body;

  try {
    const updateResponse = await postCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: story }
    );

    console.log("Story updated: ", updateResponse);

    res.send({
      message: "Story updated successfully"
    });
  } catch (error) {
    console.error("Error updating story:", error);
    res.status(500).send({ message: "Failed to update story, please try later" });
  }
});

app.delete("/api/v1/story/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(403).send({ message: "Incorrect story id" });
    return;
  }

  try {
    const deleteResponse = await postCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    console.log("Story deleted: ", deleteResponse);

    res.send({
      message: "Story deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting story:", error);
    res.status(500).send({ message: "Failed to delete story, please try later" });
  }
});

app.use((req, res) => {
  res.status(404).send("Not found");
});

const port = process.env.PORT || 5001;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
