export const getContentType = (filePath: string): string => {
  const fileExtension = filePath.toLowerCase().split(".").pop();
  let contentType = "application/octet-stream"; // default

  switch (fileExtension) {
    case "mp4":
    case "mov": {
      contentType = "video/mp4";
      break;
    }
    case "jpg":
    case "jpeg": {
      contentType = "image/jpeg";
      break;
    }
    case "png": {
      contentType = "image/png";
      break;
    }
    case "gif": {
      contentType = "image/gif";
      break;
    }
    case "webp": {
      contentType = "image/webp";
      break;
    }
  }

  return contentType;
};
