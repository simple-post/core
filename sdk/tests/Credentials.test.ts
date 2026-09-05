import { mergeOptions } from "../src/utils/credentials";

it("retains environment Pinterest defaults when only a title is overridden", () => {
  const credentials = { accessToken: "environment-token" };
  expect(
    mergeOptions({ pinterest: { boardId: "environment-board", credentials } }, { pinterest: { title: "Title" } }),
  ).toMatchObject({ pinterest: { boardId: "environment-board", title: "Title", credentials } });
});

it("lets explicit platform values and complete credentials override defaults", () => {
  const credentials = { accessToken: "user-token" };
  const env = { pinterest: { boardId: "environment-board", credentials: { accessToken: "environment-token" } } };
  expect(mergeOptions(env, { pinterest: { boardId: "user-board", credentials } }).pinterest).toEqual({
    boardId: "user-board",
    credentials,
  });
  expect(env.pinterest.boardId).toBe("environment-board");
});
