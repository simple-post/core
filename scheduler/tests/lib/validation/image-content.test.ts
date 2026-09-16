import { hasImageContent } from "@/lib/validation/image-content";

const image = {
  id: "image",
  type: "image" as const,
  url: "https://cdn.example.com/image.png",
  filename: "image.png",
  size: 1,
};
const video = {
  id: "video",
  type: "video" as const,
  url: "https://cdn.example.com/video.mp4",
  filename: "video.mp4",
  size: 1,
};

it("finds images in every fitted content location", () => {
  expect(hasImageContent({ media: [image] })).toBe(true);
  expect(hasImageContent({ media: [], thread: [{ message: "reply", media: [image] }] })).toBe(true);
  expect(hasImageContent({ media: [], accountOverrides: { account: { message: "override", media: [image] } } })).toBe(
    true,
  );
  expect(
    hasImageContent({ media: [], accountOverrides: { account: { thread: [{ message: "reply", media: [image] }] } } }),
  ).toBe(true);
  expect(hasImageContent({ media: [], accountOptions: { account: { thumbnailUrl: image.url } } })).toBe(true);
  expect(hasImageContent({ media: [{ ...video, thumbnailUrl: image.url }] })).toBe(true);
});

it("does not trigger image preflight for text or videos without covers", () => {
  expect(hasImageContent({ media: [] })).toBe(false);
  expect(hasImageContent({ media: [video] })).toBe(false);
});
