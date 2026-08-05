function text(value) {
  return String(value || "").trim();
}

function createDataBackedActivityAssetAdapter(options = {}) {
  const dataProvider = typeof options.dataProvider === "function"
    ? options.dataProvider
    : () => options.data || {};
  return Object.freeze({
    resolvePublicAsset(request = {}) {
      const assetRef = text(request.assetRef);
      if (!assetRef) return null;
      const data = dataProvider() || {};
      const rows = Array.isArray(data.contentAssets) ? data.contentAssets : [];
      const asset = rows.find((row) => row
        && row.content_asset_id === assetRef
        && row.state === "AUTHORIZED");
      if (!asset) return null;
      const url = text(asset.storage_external_ref);
      if (!/^https:\/\/[^\s]{1,1016}$/.test(url) && !/^cloud:\/\/[^\s]{1,1016}$/.test(url)) return null;
      return Object.freeze({ url });
    },
  });
}

module.exports = {
  createDataBackedActivityAssetAdapter,
};
