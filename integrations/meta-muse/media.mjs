import { open, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cli, isMain, META_BASE, request, required } from "./client.mjs";

export function imageRequest(prompt, reference) {
  return {
    model: "muse-image-1.0",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...(reference ? [{ type: "input_image", image_url: reference }] : []),
        ],
      },
    ],
    tools: [
      {
        type: "image_generation",
        output_format: "png",
        enable_web_search: false,
        enable_image_search: false,
        enable_shell: false,
      },
    ],
  };
}

export function segmentationRequest(prompt, imageUrl) {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use a public HTTPS image URL without credentials");
  return {
    model: "sam-3.1",
    stream: true,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
  };
}

export function transcriptionForm(audio) {
  if (
    audio.length > 32 * 1024 * 1024 - 4096 ||
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Expected a WAV smaller than 32 MB");
  let format, dataSize;
  for (let offset = 12; offset + 8 <= audio.length; ) {
    const type = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > audio.length) throw new Error("Truncated WAV");
    if (type === "fmt " && size >= 16)
      format = {
        codec: audio.readUInt16LE(start),
        channels: audio.readUInt16LE(start + 2),
        rate: audio.readUInt32LE(start + 4),
        bits: audio.readUInt16LE(start + 14),
      };
    if (type === "data") dataSize = size;
    offset = start + size + (size % 2);
  }
  if (
    !format ||
    format.codec !== 1 ||
    format.channels !== 1 ||
    format.bits !== 16 ||
    ![16_000, 24_000].includes(format.rate) ||
    !dataSize ||
    dataSize / (format.rate * 2) > 600
  )
    throw new Error("Use mono PCM16 WAV at 16 or 24 kHz, at most 10 minutes");
  const form = new FormData();
  form.set(
    "request",
    JSON.stringify({ mode: "DIARIZATION", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" }),
  );
  form.set("audio", new Blob([audio], { type: "audio/wav" }), "audio.wav");
  return form;
}

export async function runMedia(args, { env = process.env, fetchImpl = fetch } = {}) {
  const [command, input, output, reference, extra] = args;
  if (
    !["image", "transcribe", "segment"].includes(command) ||
    !input ||
    !output ||
    extra ||
    (command === "transcribe" && reference)
  )
    throw new Error(
      "Usage: media.mjs image PROMPT OUT.png [REFERENCE.png] | transcribe IN.wav OUT.json | segment PUBLIC_IMAGE_URL OUT.sse OBJECT",
    );
  // Segment's fourth argument is the concrete object, not a reference image.
  return generate(command, input, output, reference, { env, fetchImpl });
}

async function generate(command, input, output, reference, { env, fetchImpl }) {
  const key = required(env, "MODEL_API_KEY");
  let path = "/responses",
    body;
  if (command === "image") {
    let image;
    if (reference) {
      const bytes = await readFile(reference);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error("Reference must be PNG");
      image = `data:image/png;base64,${bytes.toString("base64")}`;
    }
    body = imageRequest(input, image);
  } else if (command === "transcribe") {
    path = "/asr/transcribe";
    body = transcriptionForm(await readFile(input));
  } else {
    if (!reference?.trim()) throw new Error("Supply a concrete object noun phrase for SAM");
    body = segmentationRequest(reference, input);
  }
  // Reserve output before paid inference. Never overwrite files, even on a race.
  // A failed request may leave an empty/partial file; inspect it before a new run.
  const file = await open(output, "wx", 0o600);
  try {
    const result = await request(META_BASE, path, { key, body, fetchImpl, raw: command === "segment" });
    if (command === "segment") {
      if (!result.headers.get("content-type")?.includes("text/event-stream"))
        throw new Error("Expected SAM event stream");
      await pipeline(Readable.fromWeb(result.body), file.createWriteStream());
    } else if (command === "image") {
      const encoded = result.output?.find((item) => item.type === "image_generation_call")?.result;
      if (!encoded) throw new Error("Model returned no image");
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error("Model returned a non-PNG result");
      await file.writeFile(bytes);
    } else {
      if (typeof result.transcript !== "string") throw new Error("Unexpected transcription response");
      await file.writeFile(`${JSON.stringify(result, null, 2)}\n`);
    }
  } finally {
    await file.close();
  }
  return output;
}

if (isMain(import.meta.url))
  await cli(async () => {
    console.log(await runMedia(process.argv.slice(2)));
  });
