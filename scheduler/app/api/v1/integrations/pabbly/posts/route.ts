import type { NextRequest } from "next/server";

import { createPost } from "@/lib/posting/create-post";
import { readPabblyCreatePostBody } from "@/lib/validations/pabbly-posts";

export async function POST(req: NextRequest) {
  return createPost(req, { readBody: readPabblyCreatePostBody });
}
