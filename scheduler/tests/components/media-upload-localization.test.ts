/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement, createRef } from "react";

import { act, cleanup, render } from "@testing-library/react";

import { MediaUpload, type MediaUploadHandle } from "@/components/media-upload";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UiLocaleProvider } from "@/lib/i18n/client";

afterEach(cleanup);
it("localizes upload feedback while preserving filenames and rejecting the same invalid file", async () => {
  const ref = createRef<MediaUploadHandle>();
  const onMediaChange = jest.fn();
  const source = "{{filename}} is too large. Maximum size is {{size, number}} MiB.";
  const { container } = render(
    createElement(UiLocaleProvider, {
      locale: "ar",
      messages: { [source]: "LIMIT {{size, number}} MiB — {{filename}}" },
      children: createElement(TooltipProvider, {
        children: createElement(MediaUpload, { ref, media: [], onMediaChange, maxFileSize: 1024 * 1024 }),
      }),
    }),
  );
  const name = "My <part1>写真</part1>.png";
  const file = new File([new Uint8Array(1024 * 1024 + 1)], name, { type: "image/png" });
  await act(async () => ref.current!.processFiles([file]));
  expect(container.textContent).toContain(`LIMIT ${new Intl.NumberFormat("ar").format(1)} MiB — ${name}`);
  expect(container.querySelector("part1")).toBeNull();
  expect(onMediaChange).not.toHaveBeenCalled();
});
