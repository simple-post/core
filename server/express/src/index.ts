import express from 'express';
import dotenv from 'dotenv';
import { post as publish } from 'unsubpost';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/post', async (req, res) => {
  try {
    await publish(req.body as any);
    res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'invalid request' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
