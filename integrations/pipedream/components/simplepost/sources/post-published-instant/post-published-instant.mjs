import common from "../common/base.mjs";
import constants from "../../common/constants.mjs";
import sampleEmit from "./test-event.mjs";

export default {
  ...common,
  key: "simplepost-post-published-instant",
  name: "New Post Published (Instant)",
  description: "Emit new event when SimplePost publishes a post to all of its accounts. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "source",
  dedupe: "unique",
  methods: {
    ...common.methods,
    getEvent() {
      return constants.WEBHOOK_EVENTS.POST_PUBLISHED;
    },
    getHistoricalPostType() {
      return "past";
    },
    getSummary({ post }) {
      return `Post published: ${post.message?.slice(0, 60) || post.id}`;
    },
  },
  sampleEmit,
};
