const { isPersistedMedia, uploadCloudMedia } = require("./cloud-media-upload");

function isPersistedAvatar(value) {
  return isPersistedMedia(value);
}

function uploadCloudAvatar(filePath, userId) {
  return uploadCloudMedia(filePath, { folder: "avatars", ownerId: userId });
}

module.exports = {
  isPersistedAvatar,
  uploadCloudAvatar,
};
