import type { NextApiRequest, NextApiResponse } from 'next';
import { post as publish } from 'unsubpost';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await publish(req.body as any);
    res.status(200).json({ status: 'ok' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'invalid request' });
  }
}
