import simplepost from "../../simplepost.app.mjs";

export default {
  key: "simplepost-get-post",
  name: "Get Post",
  description: "Get a post's status, schedule, and per-account publishing results, including links to the published posts. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  props: {
    simplepost,
    postId: {
      propDefinition: [
        simplepost,
        "postId",
      ],
    },
  },
  async run({ $ }) {
    const { post } = await this.simplepost.getPost({
      $,
      postId: this.postId,
    });
    $.export("$summary", `Retrieved post ${post.id} (${post.status})`);
    return post;
  },
};
