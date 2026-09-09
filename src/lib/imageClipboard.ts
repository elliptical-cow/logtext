import { Image } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

export type ImageContextMenuTarget = {
  x: number;
  y: number;
  image: HTMLImageElement;
};

export async function copyImageElementToClipboard(image: HTMLImageElement) {
  if (!image.complete) {
    await image.decode();
  }
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    throw new Error("The image has not finished loading");
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Logtext could not prepare the image for the clipboard");
  }

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = new Uint8Array(
    imageData.data.buffer.slice(
      imageData.data.byteOffset,
      imageData.data.byteOffset + imageData.data.byteLength,
    ),
  );
  const clipboardImage = await Image.new(rgba, canvas.width, canvas.height);
  try {
    await writeImage(clipboardImage);
  } finally {
    await clipboardImage.close();
  }
}
