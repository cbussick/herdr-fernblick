// Shared with the standalone extension; only opaque IDs cross the chat socket.
export {
  saveImageUpload,
  readImageUpload,
  mimeTypeForUpload,
  imageUploadPath as getImageUploadPath,
} from "../../packages/pi-live-chat/images.js";
export { uploadIdPattern } from "../../packages/pi-live-chat/protocol.js";
