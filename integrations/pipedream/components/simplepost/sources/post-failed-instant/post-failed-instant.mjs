import common from "../common/base.mjs";
import constants from "../../common/constants.mjs";
import sampleEmit from "./test-event.mjs";

export default {
  ...common,
  key: "simplepost-post-failed-instant",
  name: "New Post Failed (Instant)",
  description: "Emit new event when a SimplePost post fails to publish on one or more of its accounts. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "source",
  dedupe: "unique",
  methods: {
    ...common.methods,
    getEvent() {
      return constants.WEBHOOK_EVENTS.POST_FAILED;
    },
    getHistoricalPostType() {
      return "failed";
    },
    getSummary({ post }) {
      return `Post failed: ${post.errorMessage || post.id}`;
    },
  },
  sampleEmit,
};
