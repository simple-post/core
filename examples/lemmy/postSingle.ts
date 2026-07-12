import { post } from "@simple-post/sdk";
import dotenv from "dotenv";
dotenv.config();
console.log(
  await post({
    content: { text: "Hello Lemmy!" },
    platforms: ["lemmy"],
    options: { lemmy: { title: "Hello Lemmy", communityId: Number(process.env.LEMMY_COMMUNITY_ID) } },
  }),
);
